export type createTransactionType = {
  amount: number;
  method: string;
  who: string;
  isUser: boolean;
  isIncomming: boolean;
  isDone: boolean;
  accountName?: string;
  bankName?: string;
  bankAccountNumber?: string;
};

export type transactionType = createTransactionType & {
  id: string;
  timestamp: Date;
};
