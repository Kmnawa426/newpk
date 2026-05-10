const SUPABASE_URL = "https://ahythdwxyaqserlznygt.supabase.co";
const SUPABASE_KEY = "sb_publishable_pCdxlnD-UOkGVMRIuuY9Gg__yreGbPz";

const { createClient } = window.supabase;
const supabaseClient = createClient(SUPABASE_URL, SUPABASE_KEY);
const db = supabaseClient;

window.supabaseClient = supabaseClient;
window.db = db;
