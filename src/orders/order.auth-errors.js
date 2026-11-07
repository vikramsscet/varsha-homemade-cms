// The shared OAuth middleware answers 401/403 with its legacy bodies. Order routes use the
// { success: false, error: { code, message } } envelope, so this thin adapter rewrites only
// those two statuses - the authentication and scope checks themselves are unchanged.
const envelopeAuthErrors = (req, res, next) => {
  const json = res.json.bind(res);
  res.json = (body) => {
    if (res.statusCode === 401) {
      return json({ success: false, error: { code: 'UNAUTHORIZED', message: 'Unauthorized' } });
    }
    if (res.statusCode === 403) {
      return json({ success: false, error: { code: 'FORBIDDEN', message: 'Required scope is missing' } });
    }
    return json(body);
  };
  next();
};

module.exports = { envelopeAuthErrors };
