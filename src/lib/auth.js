import { supabase } from './supabaseClient';

export const signUp = async (email, password, data = {}) => {
  return await supabase.auth.signUp({
    email,
    password,
    options: {
      data
    }
  });
};

export const signIn = async (email, password) => {
  return await supabase.auth.signInWithPassword({
    email,
    password
  });
};

export const signOut = async () => {
  return await supabase.auth.signOut();
};

export const getSession = async () => {
  return await supabase.auth.getSession();
};

export const onAuthStateChange = (callback) => {
  return supabase.auth.onAuthStateChange(callback);
};

export const getCurrentUser = async () => {
  const { data } = await supabase.auth.getUser();
  return data.user;
};