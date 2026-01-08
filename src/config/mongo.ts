import mongoose from 'mongoose';
import { env } from './env';

export const connectMongo = async (): Promise<void> => {
  mongoose.set('strictQuery', true);
  await mongoose.connect(env.MONGO_URI);
}
