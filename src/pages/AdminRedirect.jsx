import React, { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';

export default function AdminRedirect() {
  const navigate = useNavigate();
  
  useEffect(() => {
    navigate('/admin/doramas', { replace: true });
  }, [navigate]);

  return null;
}