import { createClient } from '@supabase/supabase-js';

const supabaseUrl = 'https://fbngdxhkaueaolnyswgn.supabase.co';
const supabaseAnonKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZibmdkeGhrYXVlYW9sbnlzd2duIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjM4MjQ5MTcsImV4cCI6MjA3OTQwMDkxN30.fm9MKpmmNadMpbPVekIpwyTuyW9cLO9KRyCbJIOQWSM';

const customSupabaseClient = createClient(supabaseUrl, supabaseAnonKey);

export default customSupabaseClient;

export { 
    customSupabaseClient,
    customSupabaseClient as supabase,
};
