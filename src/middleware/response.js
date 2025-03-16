// src/middleware/response.js
module.exports = (req, res, next) => {
  res.sendResponse = (status, success, message, data = null, error = null) => {
    const response = { success, message };
    if (data !== null) response.data = data;
    if (error !== null) response.error = error;
    res.status(status).json(response);
  };
  next();
};
