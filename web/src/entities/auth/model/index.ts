export interface AppUser {
  username: string;
  label: string;
  role: 'admin' | 'operator';
}

export interface LoginResponse {
  accessToken: string;
  user: AppUser;
}
