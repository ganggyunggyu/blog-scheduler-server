import mongoose, { Schema, type FilterQuery, type Model } from 'mongoose';

const ACCOUNT_DIRECTORY_COLLECTION_NAME = 'blogaccounts';
const ACCOUNT_DIRECTORY_MODEL_NAME = 'AccountDirectory';

export interface AccountDirectoryRecord {
  accountId?: string;
  password?: string;
  nickname?: string;
  blogId?: string;
  category?: string;
  isEnabled?: boolean;
  status?: string;
  note?: string;
}

export interface ResolvedAccount {
  id: string;
  password?: string;
  name: string;
  blogId?: string;
  category?: string;
}

interface RuntimeAccountCredentialRecord {
  password?: string;
}

const accountDirectorySchema = new Schema<AccountDirectoryRecord>(
  {
    accountId: String,
    password: String,
    nickname: String,
    blogId: String,
    category: String,
    isEnabled: Boolean,
    status: String,
    note: String,
  },
  {
    collection: ACCOUNT_DIRECTORY_COLLECTION_NAME,
    strict: false,
    versionKey: false,
  },
);

const getAccountDirectoryModel = (): Model<AccountDirectoryRecord> => {
  const existingModel = mongoose.models[ACCOUNT_DIRECTORY_MODEL_NAME] as Model<AccountDirectoryRecord> | undefined;

  if (existingModel) {
    return existingModel;
  }

  return mongoose.model<AccountDirectoryRecord>(
    ACCOUNT_DIRECTORY_MODEL_NAME,
    accountDirectorySchema,
  );
};

export const buildAccountLookupQuery = (identity: string): FilterQuery<AccountDirectoryRecord> => ({
  $and: [
    {
      $or: [
        { isEnabled: { $exists: false } },
        { isEnabled: true },
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
  if (!record?.accountId) {
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

const buildRuntimeCredentialLookupValues = (
  identity: string,
  record: AccountDirectoryRecord,
): string[] =>
  [...new Set([
    identity,
    record.accountId,
    record.blogId,
    record.nickname,
  ].filter((value): value is string => Boolean(value?.trim())))];

const findRuntimeAccountPassword = async (
  identity: string,
  record: AccountDirectoryRecord,
): Promise<string | undefined> => {
  const lookupValues = buildRuntimeCredentialLookupValues(identity, record);
  if (lookupValues.length === 0) {
    return undefined;
  }

  const cafeDb = mongoose.connection.useDb('cafe-bot');
  const runtimeRecord = await cafeDb
    .collection<RuntimeAccountCredentialRecord>('accounts')
    .findOne(
      {
        isActive: { $ne: false },
        $or: [
          { accountId: { $in: lookupValues } },
          { blogId: { $in: lookupValues } },
          { nickname: { $in: lookupValues } },
        ],
      },
      {
        projection: { _id: 0, password: 1 },
      },
    );

  return runtimeRecord?.password;
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

  const account = mapAccountRecord(record);
  if (!account || account.password || !record) {
    return account;
  }

  return {
    ...account,
    password: await findRuntimeAccountPassword(normalizedIdentity, record),
  };
};

export const listManagedBlogAccounts = async (): Promise<ResolvedAccount[]> => {
  const accountDirectoryModel = getAccountDirectoryModel();
  const records = await accountDirectoryModel
    .find({
      $or: [
        { isEnabled: { $exists: false } },
        { isEnabled: true },
      ],
    })
    .sort({ category: 1, nickname: 1, accountId: 1 })
    .lean<AccountDirectoryRecord[]>()
    .exec();

  return records.flatMap((record) => {
    const account = mapAccountRecord(record);
    return account ? [account] : [];
  });
};
