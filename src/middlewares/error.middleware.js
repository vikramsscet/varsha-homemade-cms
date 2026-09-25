const errorHandler = (err, req, res, next) => {
  const statusCode = err.statusCode || 500;
  const response = {
    statusCode,
    message: statusCode === 500 ? 'Internal Server Error' : err.message
  };

  if (err.code) {
    response.code = err.code;
  }

  res.status(statusCode).json(response);
};

module.exports = errorHandler;
