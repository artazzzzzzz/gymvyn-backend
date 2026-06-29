function requireFeatureFlag(flagName) {
  return (req, res, next) => {
    if (process.env[flagName] !== 'true') {
      return res.status(503).json({
        error: 'FEATURE_DISABLED',
        message: 'This feature is currently unavailable.',
      });
    }
    next();
  };
}

module.exports = { requireFeatureFlag };
