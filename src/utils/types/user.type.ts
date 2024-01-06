export type createUserType = {
  name: string;
  mobile: string;
  gender: "male" | "female";
  dob: Date;
  address: string;
};
export type userType = createUserType & {
  timestamp: Date;
};
