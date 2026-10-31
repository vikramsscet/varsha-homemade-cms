const oauthService = require('./oauth.service');

const issueToken = (req, res, next) => {
  if (req.body?.grant_type !== 'client_credentials') {
    return res.status(400).json({
      error: 'unsupported_grant_type',
      error_description: 'Only client_credentials grant type is supported'
    });
  }

  try {
    const accessToken = oauthService.issueClientCredentialsToken({
      clientId: req.body.client_id,
      clientSecret: req.body.client_secret,
      scope: req.body.scope
    });

    if (!accessToken) {
      return res.status(401).json({
        error: 'invalid_client',
        error_description: 'Invalid client credentials'
      });
    }

    return res.status(200).json({
      access_token: accessToken,
      token_type: 'Bearer',
      expires_in: 900
    });
  } catch (error) {
    if (error.code === 'INVALID_SCOPE') {
      return res.status(400).json({
        error: 'invalid_scope',
        error_description: error.message
      });
    }
    return next(error);
  }
};

module.exports = {
  issueToken
};
