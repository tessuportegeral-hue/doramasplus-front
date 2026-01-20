import React from 'react';
import { Navigate } from 'react-router-dom';

const AdminProtectedRoute = ({ children }) => {
  const adminToken = localStorage.getItem('adm_token');

  if (!adminToken) {
    // If no admin token is found, redirect to the admin login page
    return <Navigate to="/admin/login" replace />;
  }

  // If token exists, render the protected component
  return children;
};

export default AdminProtectedRoute;