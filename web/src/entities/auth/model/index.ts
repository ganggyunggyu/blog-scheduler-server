export interface AppUser {
  id: string;
  username: string;
  label: string;
  isActive: boolean;
}

export interface LoginResponse {
  accessToken: string;
  user: AppUser;
}

export interface SignupParams {
  username: string;
  password: string;
  label?: string;
}
