const mongoose = require('mongoose');
const logger = require('./logger');
const connectDB = async () => {
  const uri = process.env.MONGO_URI;
  if (!uri) throw new Error('MONGO_URI environment variable is not defined');
  await mongoose.connect(uri);
  logger.info('Order Service: MongoDB connected successfully');
};
module.exports = connectDB;
