const express = require('express');
const { createClient } = require('@supabase/supabase-js');
const PDFDocument = require('pdfkit');
const { auth } = require('../../middleware/auth');

const router = express.Router();

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

// ── Gym ownership guard ───────────────────────────────────────────────────────

async function ownerGuard(req, res, next) {
  const { gymId } = req.params;
  const { data: gym } = await supabase
    .from('gyms')
    .select('id')
    .eq('id', gymId)
    .eq('owner_id', req.user.id)
    .single();

  if (!gym) return res.status(403).json({ error: 'Forbidden' });
  next();
}

// ── Date range helper ─────────────────────────────────────────────────────────

const getDateRange = (from, to) => {
  const now = new Date();
  const start = from
    ? new Date(from)
    : new Date(now.getFullYear(), now.getMonth(), 1);
  const end = to
    ? new Date(to)
    : new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59);
  return { start: start.toISOString(), end: end.toISOString() };
};

// ── Shared data helpers (used by routes + PDF) ────────────────────────────────

async function fetchSummaryData(gymId, start, end) {
  const rangeDays = (new Date(end) - new Date(start)) / (1000 * 60 * 60 * 24);
  const prevStart = new Date(new Date(start) - rangeDays * 24 * 60 * 60 * 1000).toISOString();
  const prevEnd = new Date(new Date(start) - 1000).toISOString();

  const [
    { data: currPayments },
    { data: prevPayments },
    { data: outstandingPayments },
    { data: newMembers },
    { data: activeMembers },
    { data: churnData },
    { data: suppOrders },
    { data: lockerPmts },
  ] = await Promise.all([
    supabase.from('payments').select('amount').eq('gym_id', gymId).eq('status', 'paid').gte('paid_at', start).lte('paid_at', end),
    supabase.from('payments').select('amount').eq('gym_id', gymId).eq('status', 'paid').gte('paid_at', prevStart).lte('paid_at', prevEnd),
    supabase.from('payments').select('amount').eq('gym_id', gymId).in('status', ['pending', 'overdue']),
    supabase.from('gym_memberships').select('id').eq('gym_id', gymId).gte('created_at', start).lte('created_at', end),
    supabase.from('gym_memberships').select('id').eq('gym_id', gymId).eq('status', 'active'),
    supabase.from('churn_scores').select('id').eq('gym_id', gymId).gt('score', 0.6),
    supabase.from('supplement_orders').select('total_amount').eq('gym_id', gymId).eq('status', 'delivered').gte('created_at', start).lte('created_at', end),
    supabase.from('locker_payments').select('amount').eq('gym_id', gymId).eq('payment_status', 'paid').gte('paid_at', start).lte('paid_at', end),
  ]);

  const current_revenue = (currPayments || []).reduce((s, p) => s + Number(p.amount), 0);
  const previous_revenue = (prevPayments || []).reduce((s, p) => s + Number(p.amount), 0);
  const revenue_delta_pct = previous_revenue === 0
    ? 0
    : Math.round(((current_revenue - previous_revenue) / previous_revenue) * 1000) / 10;
  const outstanding_amount = (outstandingPayments || []).reduce((s, p) => s + Number(p.amount), 0);
  const supplement_revenue = (suppOrders || []).reduce((s, o) => s + Number(o.total_amount), 0);
  const locker_revenue = (lockerPmts || []).reduce((s, p) => s + Number(p.amount), 0);

  return {
    current_revenue,
    previous_revenue,
    revenue_delta_pct,
    outstanding_amount,
    outstanding_count: (outstandingPayments || []).length,
    new_members: (newMembers || []).length,
    active_members: (activeMembers || []).length,
    at_risk_members: (churnData || []).length,
    membership_revenue: current_revenue,
    supplement_revenue,
    locker_revenue,
  };
}

async function fetchTrendData(gymId, start, end) {
  const { data: payments } = await supabase
    .from('payments')
    .select('paid_at, amount')
    .eq('gym_id', gymId)
    .eq('status', 'paid')
    .gte('paid_at', start)
    .lte('paid_at', end);

  const grouped = {};
  (payments || []).forEach(p => {
    const d = new Date(p.paid_at);
    const month = d.toLocaleDateString('en-IN', { month: 'short', year: 'numeric' });
    grouped[month] = (grouped[month] || 0) + Number(p.amount);
  });

  return Object.entries(grouped)
    .map(([month, revenue]) => ({ month, revenue }))
    .sort((a, b) => new Date('1 ' + a.month) - new Date('1 ' + b.month));
}

async function fetchTopMembersData(gymId, start, end, limit = 10) {
  const { data: payments } = await supabase
    .from('payments')
    .select('user_id, amount')
    .eq('gym_id', gymId)
    .eq('status', 'paid')
    .gte('paid_at', start)
    .lte('paid_at', end);

  const memberTotals = {};
  (payments || []).forEach(p => {
    memberTotals[p.user_id] = (memberTotals[p.user_id] || 0) + Number(p.amount);
  });

  const topEntries = Object.entries(memberTotals)
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit);

  if (topEntries.length === 0) return [];

  const { data: users } = await supabase
    .from('users')
    .select('id, full_name')
    .in('id', topEntries.map(([id]) => id));

  const nameMap = {};
  (users || []).forEach(u => { nameMap[u.id] = u.full_name; });

  return topEntries.map(([member_id, total_paid], i) => ({
    rank: i + 1,
    member_id,
    name: nameMap[member_id] || 'Unknown',
    total_paid,
  }));
}

// ── GET /:gymId/summary ───────────────────────────────────────────────────────

router.get('/:gymId/summary', auth, ownerGuard, async (req, res) => {
  try {
    const { gymId } = req.params;
    const { start, end } = getDateRange(req.query.from, req.query.to);
    const data = await fetchSummaryData(gymId, start, end);
    res.json(data);
  } catch (err) {
    console.error('GET /:gymId/summary error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ── GET /:gymId/revenue-trend ─────────────────────────────────────────────────

router.get('/:gymId/revenue-trend', auth, ownerGuard, async (req, res) => {
  try {
    const { gymId } = req.params;
    const { start, end } = getDateRange(req.query.from, req.query.to);
    const data = await fetchTrendData(gymId, start, end);
    res.json(data);
  } catch (err) {
    console.error('GET /:gymId/revenue-trend error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ── GET /:gymId/top-members ───────────────────────────────────────────────────

router.get('/:gymId/top-members', auth, ownerGuard, async (req, res) => {
  try {
    const { gymId } = req.params;
    const { start, end } = getDateRange(req.query.from, req.query.to);
    const limit = Math.min(50, parseInt(req.query.limit) || 10);
    const data = await fetchTopMembersData(gymId, start, end, limit);
    res.json(data);
  } catch (err) {
    console.error('GET /:gymId/top-members error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ── GET /:gymId/trainer-performance ──────────────────────────────────────────

router.get('/:gymId/trainer-performance', auth, ownerGuard, async (req, res) => {
  try {
    const { gymId } = req.params;
    const { start, end } = getDateRange(req.query.from, req.query.to);

    const { data: trainerProfiles, error } = await supabase
      .from('trainer_profiles')
      .select('user_id')
      .eq('gym_id', gymId)
      .eq('is_active', true);

    if (error) return res.status(500).json({ error: error.message });
    if (!trainerProfiles || trainerProfiles.length === 0) return res.json([]);

    const trainerIds = trainerProfiles.map(t => t.user_id);

    const { data: users } = await supabase
      .from('users')
      .select('id, full_name')
      .in('id', trainerIds);

    const nameMap = {};
    (users || []).forEach(u => { nameMap[u.id] = u.full_name; });

    const result = await Promise.all(
      trainerIds.map(async trainer_id => {
        const { data: clients } = await supabase
          .from('trainer_clients')
          .select('client_id')
          .eq('trainer_id', trainer_id)
          .eq('gym_id', gymId)
          .eq('status', 'active');

        const client_count = (clients || []).length;
        const clientIds = (clients || []).map(c => c.client_id);

        let sessions_in_period = 0;
        if (clientIds.length > 0) {
          const { data: logs } = await supabase
            .from('workout_logs')
            .select('id')
            .in('user_id', clientIds)
            .gte('created_at', start)
            .lte('created_at', end);
          sessions_in_period = (logs || []).length;
        }

        return { trainer_id, name: nameMap[trainer_id] || 'Unknown', client_count, sessions_in_period, revenue: 0 };
      })
    );

    res.json(result);
  } catch (err) {
    console.error('GET /:gymId/trainer-performance error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ── GET /:gymId/attendance ────────────────────────────────────────────────────

router.get('/:gymId/attendance', auth, ownerGuard, async (req, res) => {
  try {
    const { gymId } = req.params;
    const { start, end } = getDateRange(req.query.from, req.query.to);

    const { data: checkins, error } = await supabase
      .from('check_ins')
      .select('user_id, checked_in_at')
      .eq('gym_id', gymId)
      .gte('checked_in_at', start)
      .lte('checked_in_at', end);

    if (error) return res.status(500).json({ error: error.message });
    if (!checkins || checkins.length === 0) return res.json([]);

    const memberStats = {};
    checkins.forEach(c => {
      if (!memberStats[c.user_id]) memberStats[c.user_id] = { count: 0, last: null };
      memberStats[c.user_id].count += 1;
      if (!memberStats[c.user_id].last || c.checked_in_at > memberStats[c.user_id].last) {
        memberStats[c.user_id].last = c.checked_in_at;
      }
    });

    const { data: users } = await supabase
      .from('users')
      .select('id, full_name')
      .in('id', Object.keys(memberStats));

    const nameMap = {};
    (users || []).forEach(u => { nameMap[u.id] = u.full_name; });

    const result = Object.entries(memberStats)
      .map(([member_id, stats]) => ({
        member_id,
        name: nameMap[member_id] || 'Unknown',
        check_in_count: stats.count,
        last_check_in: stats.last ? stats.last.split('T')[0] : null,
      }))
      .sort((a, b) => b.check_in_count - a.check_in_count);

    res.json(result);
  } catch (err) {
    console.error('GET /:gymId/attendance error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ── GET /:gymId/churn-risk ────────────────────────────────────────────────────

router.get('/:gymId/churn-risk', auth, ownerGuard, async (req, res) => {
  try {
    const { gymId } = req.params;

    const { data: churnData, error } = await supabase
      .from('churn_scores')
      .select('user_id, score, predicted_at')
      .eq('gym_id', gymId)
      .gt('score', 0.6)
      .order('score', { ascending: false });

    if (error) return res.status(500).json({ error: error.message });
    if (!churnData || churnData.length === 0) return res.json([]);

    const userIds = churnData.map(c => c.user_id);
    const { data: users } = await supabase
      .from('users')
      .select('id, full_name')
      .in('id', userIds);

    const nameMap = {};
    (users || []).forEach(u => { nameMap[u.id] = u.full_name; });

    const result = churnData.map(c => ({
      member_id: c.user_id,
      name: nameMap[c.user_id] || 'Unknown',
      churn_score: Number(c.score),
      last_updated: c.predicted_at ? c.predicted_at.split('T')[0] : null,
    }));

    res.json(result);
  } catch (err) {
    console.error('GET /:gymId/churn-risk error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ── GET /:gymId/pdf/monthly-revenue ──────────────────────────────────────────

router.get('/:gymId/pdf/monthly-revenue', auth, ownerGuard, async (req, res) => {
  try {
    const { gymId } = req.params;
    const { start, end } = getDateRange(req.query.from, req.query.to);

    const [summary, trend, topMembers, gymRow] = await Promise.all([
      fetchSummaryData(gymId, start, end),
      fetchTrendData(gymId, start, end),
      fetchTopMembersData(gymId, start, end, 10),
      supabase.from('gyms').select('name').eq('id', gymId).single(),
    ]);

    const gymName = gymRow.data?.name || 'Your Gym';
    const startLabel = new Date(start).toLocaleDateString('en-IN', { month: 'long', year: 'numeric' });
    const endLabel = new Date(end).toLocaleDateString('en-IN', { month: 'long', year: 'numeric' });
    const periodLabel = startLabel === endLabel ? startLabel : `${startLabel} - ${endLabel}`;
    const rupee = 'Rs.';

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="revenue-report-${gymId}-${start.slice(0, 7)}.pdf"`);

    const doc = new PDFDocument({ margin: 50, size: 'A4' });
    doc.pipe(res);

    const pageW = doc.page.width;

    // ── Header bar ────────────────────────────────────────────────────────────
    doc.rect(0, 0, pageW, 80).fill('#1A1613');

    doc.fontSize(22).fillColor('#F2EDE6').font('Helvetica-Bold')
      .text('Gymvyn', 50, 24);

    doc.fontSize(10).fillColor('#A8A097').font('Helvetica')
      .text('Revenue Report', 50, 52);

    doc.fontSize(10).fillColor('#F2EDE6').font('Helvetica-Bold')
      .text(gymName, 50, 24, { align: 'right' });

    doc.fontSize(9).fillColor('#A8A097').font('Helvetica')
      .text(periodLabel, 50, 40, { align: 'right' });

    // ── Summary section ───────────────────────────────────────────────────────
    let y = 100;

    doc.fontSize(13).fillColor('#0D0D0D').font('Helvetica-Bold')
      .text('Summary', 50, y);

    y += 18;
    doc.moveTo(50, y).lineTo(pageW - 50, y).strokeColor('#E5E5EA').lineWidth(1).stroke();
    y += 10;

    const deltaSign = summary.revenue_delta_pct >= 0 ? '+' : '';
    const summaryRows = [
      ['Total Revenue',          `${rupee} ${summary.current_revenue.toLocaleString('en-IN')}`],
      ['vs Previous Period',     `${deltaSign}${summary.revenue_delta_pct.toFixed(1)}%`],
      ['Outstanding Payments',   `${rupee} ${summary.outstanding_amount.toLocaleString('en-IN')} (${summary.outstanding_count} payments)`],
      ['New Members',            `${summary.new_members}`],
      ['Active Members',         `${summary.active_members}`],
      ['Members at Churn Risk',  `${summary.at_risk_members}`],
    ];

    summaryRows.forEach(([label, value]) => {
      doc.fontSize(10).fillColor('#6B6B6B').font('Helvetica').text(label, 50, y);
      doc.fontSize(10).fillColor('#0D0D0D').font('Helvetica-Bold').text(value, 300, y);
      y += 22;
    });

    // ── Revenue breakdown ─────────────────────────────────────────────────────
    y += 10;
    doc.fontSize(13).fillColor('#0D0D0D').font('Helvetica-Bold').text('Revenue by Source', 50, y);
    y += 20;
    doc.moveTo(50, y).lineTo(pageW - 50, y).strokeColor('#E5E5EA').lineWidth(1).stroke();
    y += 10;

    const breakdownRows = [
      ['Membership Fees',  summary.membership_revenue],
      ['Supplement Sales', summary.supplement_revenue],
      ['Locker Payments',  summary.locker_revenue],
    ];

    breakdownRows.forEach(([label, amount]) => {
      doc.fontSize(10).fillColor('#6B6B6B').font('Helvetica').text(label, 50, y);
      doc.fontSize(10).fillColor('#0D0D0D').font('Helvetica-Bold')
        .text(`${rupee} ${amount.toLocaleString('en-IN')}`, 300, y);
      y += 22;
    });

    y += 4;
    doc.moveTo(50, y).lineTo(pageW - 50, y).strokeColor('#0D0D0D').lineWidth(0.5).stroke();
    y += 8;
    doc.fontSize(11).fillColor('#0D0D0D').font('Helvetica-Bold').text('Total', 50, y);
    doc.fontSize(11).fillColor('#0D0D0D').font('Helvetica-Bold')
      .text(`${rupee} ${summary.current_revenue.toLocaleString('en-IN')}`, 300, y);

    // ── Monthly trend table ───────────────────────────────────────────────────
    y += 40;
    doc.fontSize(13).fillColor('#0D0D0D').font('Helvetica-Bold').text('Monthly Trend', 50, y);
    y += 20;
    doc.moveTo(50, y).lineTo(pageW - 50, y).strokeColor('#E5E5EA').lineWidth(1).stroke();
    y += 10;

    doc.fontSize(9).fillColor('#6B6B6B').font('Helvetica-Bold')
      .text('Month', 50, y).text('Revenue', 300, y);
    y += 18;

    trend.forEach(({ month, revenue }) => {
      if (y > doc.page.height - 100) { doc.addPage(); y = 50; }
      doc.fontSize(10).fillColor('#0D0D0D').font('Helvetica').text(month, 50, y);
      doc.fontSize(10).fillColor('#0D0D0D').font('Helvetica')
        .text(`${rupee} ${revenue.toLocaleString('en-IN')}`, 300, y);
      y += 20;
    });

    // ── Top members table ─────────────────────────────────────────────────────
    if (y > doc.page.height - 200) { doc.addPage(); y = 50; }

    y += 20;
    doc.fontSize(13).fillColor('#0D0D0D').font('Helvetica-Bold').text('Top Members', 50, y);
    y += 20;
    doc.moveTo(50, y).lineTo(pageW - 50, y).strokeColor('#E5E5EA').lineWidth(1).stroke();
    y += 10;

    doc.fontSize(9).fillColor('#6B6B6B').font('Helvetica-Bold')
      .text('#', 50, y).text('Member', 80, y).text('Total Paid', 380, y);
    y += 18;

    topMembers.forEach(({ rank, name, total_paid }) => {
      if (y > doc.page.height - 100) { doc.addPage(); y = 50; }
      doc.fontSize(10).fillColor('#6B6B6B').font('Helvetica').text(`${rank}`, 50, y);
      doc.fontSize(10).fillColor('#0D0D0D').font('Helvetica').text(name, 80, y);
      doc.fontSize(10).fillColor('#0D0D0D').font('Helvetica')
        .text(`${rupee} ${total_paid.toLocaleString('en-IN')}`, 380, y);
      y += 20;
    });

    // ── Footer ────────────────────────────────────────────────────────────────
    const footerY = doc.page.height - 50;
    doc.fontSize(8).fillColor('#A8A097').font('Helvetica')
      .text(
        `Generated on ${new Date().toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' })}   |   Confidential - ${gymName}`,
        50, footerY, { align: 'center' }
      );

    doc.end();
  } catch (err) {
    console.error('GET /:gymId/pdf/monthly-revenue error:', err);
    if (!res.headersSent) res.status(500).json({ error: err.message });
    else res.end();
  }
});

module.exports = router;
