const { validateAccessToken } = require('../services/jwt.service');

const sendUnauthorized = (res) => res.status(401).json({
  statusCode: 401,
  message: 'Unauthorized'
});

const authenticateOAuthToken = (req, res, next) => {
  const authorization = req.headers?.authorization;
  const match = typeof authorization === 'string'
    ? /^Bearer\s+([^\s]+)$/i.exec(authorization)
    : null;

  if (!match) {
    return sendUnauthorized(res);
  }

  try {
    const payload = validateAccessToken(match[1]);
    req.auth = {
      clientId: payload.client_id,
      scopes: payload.scope.split(/\s+/).filter(Boolean),
      sub: payload.sub
    };
    return next();
  } catch (error) {
    console.error('Error validating access token:', error);
    if (error.code === 'JWT_CONFIGURATION_ERROR') {
      return next(error);
    }
    return sendUnauthorized(res);
  }
};

module.exports = {
  authenticateOAuthToken
};