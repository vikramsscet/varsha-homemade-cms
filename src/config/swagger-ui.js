// Swagger UI's OAuth "Authorize" dialog always sends client-credentials as an
// HTTP Basic header and offers no setting to use the request body instead. This
// request interceptor moves those credentials into the form body of the token
// request, which is where POST /api/v1/oauth/token expects them.
//
// It is serialized into the browser by swagger-ui-express, so it must stay
// self-contained (no references to anything outside the function) and must
// never log or store the credentials it handles.
function moveClientCredentialsToBody(request) {
  var isTokenRequest = String(request.method).toUpperCase() === 'POST' && /\/oauth\/token(\?|$)/.test(request.url);
  var headers = request.headers || {};
  var headerName = Object.keys(headers).filter(function (name) { return name.toLowerCase() === 'authorization'; })[0];
  var header = headerName && headers[headerName];
  if (!isTokenRequest || typeof header !== 'string' || typeof request.body !== 'string') {
    return request;
  }

  var match = /^Basic\s+(.+)$/i.exec(header);
  if (!match) {
    return request;
  }

  var decoded;
  try {
    var bytes = Uint8Array.from(atob(match[1]), function (char) { return char.charCodeAt(0); });
    decoded = new TextDecoder().decode(bytes);
  } catch (error) {
    return request;
  }

  var separator = decoded.indexOf(':');
  if (separator < 0) {
    return request;
  }

  var params = new URLSearchParams(request.body);
  params.set('client_id', decoded.slice(0, separator));
  params.set('client_secret', decoded.slice(separator + 1));
  request.body = params.toString();
  delete request.headers[headerName];
  return request;
}

module.exports = {
  swaggerOptions: {
    requestInterceptor: moveClientCredentialsToBody
  }
};
