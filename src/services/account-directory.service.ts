import mongoose, { Schema, type FilterQuery, type Model } from 'mongoose';

const ACCOUNT_DIRECTORY_DB_NAME = 'cafe-bot';
const ACCOUNT_DIRECTORY_COLLECTION_NAME = 'accounts';
const ACCOUNT_DIRECTORY_MODEL_NAME = 'AccountDirectory';

interface AccountDirectoryRecord {
  accountId?: string;
  password?: string;
  nickname?: string;
  blogId?: string;
  category?: string;
  isActive?: boolean;
}

export interface ResolvedAccount {
  id: string;
  password: string;
  name: string;
  blogId?: string;
  category?: string;
}

const accountDirectorySchema = new Schema<AccountDirectoryRecord>(
  {
    accountId: String,
    password: String,
    nickname: String,
    blogId: String,
    category: String,
    isActive: Boolean,
  },
  {
    collection: ACCOUNT_DIRECTORY_COLLECTION_NAME,
    strict: false,
    versionKey: false,
  },
);

const getAccountDirectoryModel = (): Model<AccountDirectoryRecord> => {
  const accountDb = mongoose.connection.useDb(ACCOUNT_DIRECTORY_DB_NAME, { useCache: true });
  const existingModel = accountDb.models[ACCOUNT_DIRECTORY_MODEL_NAME] as Model<AccountDirectoryRecord> | undefined;

  if (existingModel) {
    return existingModel;
  }

  return accountDb.model<AccountDirectoryRecord>(
    ACCOUNT_DIRECTORY_MODEL_NAME,
    accountDirectorySchema,
  );
};

export const buildAccountLookupQuery = (identity: string): FilterQuery<AccountDirectoryRecord> => ({
  $and: [
    {
      $or: [
        { isActive: { $exists: false } },
        { isActive: true },
      ],
    },
    {
      $or: [
        { accountId: identity },
        { blogId: identity },
        { nickname: identity },
      ],
    },
  ],
});

export const mapAccountRecord = (
  record: AccountDirectoryRecord | null | undefined,
): ResolvedAccount | null => {
  if (!record?.accountId || !record.password) {
    return null;
  }

  return {
    id: record.accountId,
    password: record.password,
    name: record.nickname?.trim() || record.accountId,
    blogId: record.blogId,
    category: record.category,
  };
};

export const findAccountById = async (identity: string): Promise<ResolvedAccount | null> => {
  const normalizedIdentity = identity.trim();

  if (!normalizedIdentity) {
    return null;
  }

  const accountDirectoryModel = getAccountDirectoryModel();
  const record = await accountDirectoryModel
    .findOne(buildAccountLookupQuery(normalizedIdentity))
    .lean<AccountDirectoryRecord | null>()
    .exec();

  return mapAccountRecord(record);
};
