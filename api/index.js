const requestHandler = require('../server');

// Para uso na Vercel como serverless function
module.exports = (req, res) => {
  return requestHandler(req, res);
};
