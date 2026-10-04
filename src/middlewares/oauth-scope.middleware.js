const requireScope = (scope) => {
  if (typeof scope !== 'string' || !scope.trim()) {
    throw new TypeError('A required OAuth scope must be provided');
  }

  const requiredScope = scope.trim();

  return (req, res, next) => {
    if (!req.auth?.clientId) {
      return res.status(401).json({
        statusCode: 401,
        message: 'Unauthorized'
      });
    }

    if (!Array.isArray(req.auth.scopes) || !req.auth.scopes.includes(requiredScope)) {
      return res.status(403).json({
        error: 'insufficient_scope',
        error_description: 'Required scope is missing'
      });
    }

    return next();
  };
};

module.exports = {
  requireScope
};