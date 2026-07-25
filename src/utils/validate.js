// Shared zod request-body validator. Originally defined inline in server.js
// (used for the membership-plan routes); extracted here so route modules
// outside server.js can reuse the same pattern instead of re-implementing
// their own ad hoc Number()/if-checks per field.
function validate(schema) {
  return (req, res, next) => {
    const result = schema.safeParse(req.body);
    if (!result.success) {
      const message = result.error.issues
        .map(e => `${e.path.join('.') || 'body'}: ${e.message}`)
        .join('; ');
      return res.status(400).json({ error: 'Validation failed', message });
    }
    req.body = result.data;
    next();
  };
}

module.exports = { validate };
