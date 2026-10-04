const dotenv = require('dotenv');

dotenv.config();

module.exports = {
  NODE_ENV: process.env.NODE_ENV || 'development',
  PORT: Number(process.env.PORT) || 3000,
  API_PREFIX: process.env.API_PREFIX || '/api/v1',
  APP_URL: process.env.APP_URL || 'http://localhost:3000',
  CMS_OAUTH_CLIENT_ID: process.env.CMS_OAUTH_CLIENT_ID,
  CMS_OAUTH_CLIENT_SECRET: process.env.CMS_OAUTH_CLIENT_SECRET,
  JWT_ISSUER: process.env.JWT_ISSUER,
  JWT_AUDIENCE: process.env.JWT_AUDIENCE,
  JWT_EXPIRES_IN: process.env.JWT_EXPIRES_IN,
  JWT_PRIVATE_KEY: process.env.JWT_PRIVATE_KEY,
  JWT_PUBLIC_KEY: process.env.JWT_PUBLIC_KEY,
  CMS_OAUTH_SCOPES: process.env.CMS_OAUTH_SCOPES
};
