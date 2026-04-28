CREATE OR REPLACE FUNCTION check_and_claim_session(
  p_user_id UUID,
  p_new_version UUID
) RETURNS TABLE(allowed BOOLEAN, existing_version UUID) AS $$
BEGIN
  -- Tenta adquirir lock exclusivo na linha
  PERFORM 1 FROM active_sessions
  WHERE user_id = p_user_id
  FOR UPDATE SKIP LOCKED;

  -- Se conseguiu lock (ou não existe linha), pode entrar
  INSERT INTO active_sessions (user_id, session_version, updated_at)
  VALUES (p_user_id, p_new_version, NOW())
  ON CONFLICT (user_id) DO UPDATE
  SET session_version = p_new_version, updated_at = NOW();

  RETURN QUERY SELECT true::BOOLEAN, p_new_version;
END;
$$ LANGUAGE plpgsql;
