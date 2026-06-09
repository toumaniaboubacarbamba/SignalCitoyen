import React, { createContext, useState, useContext, useEffect } from 'react';
import { Platform } from 'react-native';
import axios from 'axios';
import { storage } from '@/src/utils/storage';
import * as Notifications from 'expo-notifications';

const BACKEND_URL = process.env.EXPO_PUBLIC_BACKEND_URL;

async function registerForPush(userId: string) {
  if (Platform.OS === 'web') return;
  try {
    const { status } = await Notifications.requestPermissionsAsync();
    if (status !== 'granted') return;

    const tokenResp = await Notifications.getDevicePushTokenAsync();
    await axios.post(`${BACKEND_URL}/api/register-push`, {
      user_id: userId,
      platform: Platform.OS,
      device_token: tokenResp.data,
    });
  } catch (error) {
    console.warn('Push registration failed (non-blocking):', error);
  }
}

interface User {
  id: string;
  email: string;
  name: string;
  role: string;
  created_at: string;
}

interface AuthContextType {
  user: User | null;
  token: string | null;
  isLoading: boolean;
  login: (email: string, password: string) => Promise<void>;
  register: (email: string, password: string, name: string) => Promise<void>;
  logout: () => Promise<void>;
  isAdmin: boolean;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    loadStoredAuth();
  }, []);

  const loadStoredAuth = async () => {
    try {
      const storedToken = await storage.getItem('auth_token', '');
      const storedUserStr = await storage.getItem('user', '');
      
      if (storedToken && storedUserStr) {
        const storedUser = JSON.parse(storedUserStr as string);
        setToken(storedToken as string);
        setUser(storedUser);
        
        // Configure axios default header
        axios.defaults.headers.common['Authorization'] = `Bearer ${storedToken}`;
        
        // Re-register for push on app open
        registerForPush(storedUser.id);
      }
    } catch (error) {
      console.error('Error loading auth:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const login = async (email: string, password: string) => {
    try {
      const response = await axios.post(`${BACKEND_URL}/api/auth/login`, {
        email,
        password,
      });

      const { access_token, user: userData } = response.data;
      
      await storage.setItem('auth_token', access_token);
      await storage.setItem('user', JSON.stringify(userData));
      
      setToken(access_token);
      setUser(userData);
      
      axios.defaults.headers.common['Authorization'] = `Bearer ${access_token}`;
    } catch (error: any) {
      console.error('Login error:', error);
      throw new Error(error.response?.data?.detail || error.message || 'Erreur de connexion');
    }
    
    // Register for push after successful login
    const userInfo = await storage.getItem('user', '');
    if (userInfo) {
      try {
        const u = JSON.parse(userInfo as string);
        registerForPush(u.id);
      } catch {}
    }
  };

  const register = async (email: string, password: string, name: string) => {
    try {
      const response = await axios.post(`${BACKEND_URL}/api/auth/register`, {
        email,
        password,
        name,
        role: 'citizen',
      });

      const { access_token, user: userData } = response.data;
      
      await storage.setItem('auth_token', access_token);
      await storage.setItem('user', JSON.stringify(userData));
      
      setToken(access_token);
      setUser(userData);
      
      axios.defaults.headers.common['Authorization'] = `Bearer ${access_token}`;
      
      // Register for push after successful registration
      registerForPush(userData.id);
    } catch (error: any) {
      console.error('Register error:', error);
      throw new Error(error.response?.data?.detail || error.message || 'Erreur d\'inscription');
    }
  };

  const logout = async () => {
    await storage.removeItem('auth_token');
    await storage.removeItem('user');
    
    setToken(null);
    setUser(null);
    
    delete axios.defaults.headers.common['Authorization'];
  };

  const isAdmin = user?.role === 'admin';

  return (
    <AuthContext.Provider
      value={{
        user,
        token,
        isLoading,
        login,
        register,
        logout,
        isAdmin,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
