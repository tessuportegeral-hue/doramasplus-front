import React from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from './ui/button';

const CallToAction = () => {
  const navigate = useNavigate();

  return (
    <div className="text-center">
        <Button onClick={() => navigate('/signup')}>
            Comece a assistir agora
        </Button>
    </div>
  );
};

export default CallToAction;