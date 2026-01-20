// Fake authentication system using localStorage
// Ready to be replaced with Supabase authentication

const AUTH_KEY = 'doramastream_auth';
const USER_KEY = 'doramastream_user';

export const fakeAuth = {
  // Sign up a new user
  signup: async (email, password, name) => {
    return new Promise((resolve, reject) => {
      setTimeout(() => {
        // Simulate API call
        const users = JSON.parse(localStorage.getItem('doramastream_users') || '[]');
        
        // Check if user already exists
        const existingUser = users.find(u => u.email === email);
        if (existingUser) {
          reject(new Error('User already exists'));
          return;
        }

        // Create new user
        const newUser = {
          id: Date.now().toString(),
          email,
          name,
          password, // In real app, this would be hashed
          createdAt: new Date().toISOString()
        };

        users.push(newUser);
        localStorage.setItem('doramastream_users', JSON.stringify(users));

        // Auto login after signup
        const userWithoutPassword = { ...newUser };
        delete userWithoutPassword.password;
        
        localStorage.setItem(AUTH_KEY, 'true');
        localStorage.setItem(USER_KEY, JSON.stringify(userWithoutPassword));

        resolve(userWithoutPassword);
      }, 800);
    });
  },

  // Login user
  login: async (email, password) => {
    return new Promise((resolve, reject) => {
      setTimeout(() => {
        const users = JSON.parse(localStorage.getItem('doramastream_users') || '[]');
        const user = users.find(u => u.email === email && u.password === password);

        if (!user) {
          reject(new Error('Invalid credentials'));
          return;
        }

        const userWithoutPassword = { ...user };
        delete userWithoutPassword.password;

        localStorage.setItem(AUTH_KEY, 'true');
        localStorage.setItem(USER_KEY, JSON.stringify(userWithoutPassword));

        resolve(userWithoutPassword);
      }, 800);
    });
  },

  // Logout user
  logout: () => {
    localStorage.removeItem(AUTH_KEY);
    localStorage.removeItem(USER_KEY);
  },

  // Check if user is authenticated
  isAuthenticated: () => {
    return localStorage.getItem(AUTH_KEY) === 'true';
  },

  // Get current user
  getCurrentUser: () => {
    const userStr = localStorage.getItem(USER_KEY);
    return userStr ? JSON.parse(userStr) : null;
  }
};