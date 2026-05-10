const SESSION_KEY = "attendanceSession";
const SESSION_DURATION_MS = 8 * 60 * 60 * 1000;

function setSession(session) {
  localStorage.setItem(
    SESSION_KEY,
    JSON.stringify({
      ...session,
      createdAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + SESSION_DURATION_MS).toISOString()
    })
  );
}

function getSession() {
  const raw = localStorage.getItem(SESSION_KEY);
  if (!raw) {
    return null;
  }

  try {
    const session = JSON.parse(raw);

    if (!session.expiresAt || new Date(session.expiresAt).getTime() <= Date.now()) {
      clearSession();
      return null;
    }

    return session;
  } catch (error) {
    console.error("Invalid session payload:", error);
    clearSession();
    return null;
  }
}

function clearSession() {
  localStorage.removeItem(SESSION_KEY);
}

async function signOutAndClearSession() {
  try {
    const client = window.supabaseClient || null;
    if (client && client.auth) {
      await client.auth.signOut();
    }
  } catch (error) {
    console.error("Supabase sign out failed:", error);
  } finally {
    clearSession();
  }
}

function requireRole(role) {
  const session = getSession();
  if (!session || session.role?.toLowerCase() !== role.toLowerCase()){
    window.location.href = "index.html";
    return null;
  }
  return session;
}

function buildProfileFromMetadata(user) {
  const userMeta = user?.user_metadata || {};
  const appMeta = user?.app_metadata || {};
  const role = userMeta.role || appMeta.role || "";

  if (!role) {
    return null;
  }

  return {
    id: user.id,
    role,
    name: userMeta.name || userMeta.full_name || appMeta.name || user.email || "",
    teacher_id: userMeta.teacher_id || appMeta.teacher_id || null,
    teacher_code: userMeta.teacher_code || appMeta.teacher_code || userMeta.teacherId || appMeta.teacherId || "",
    student_id: userMeta.student_id || appMeta.student_id || null
  };
}

async function loadEffectiveProfile(user) {
  const { data: profile, error: profileError } = await db
    .from("profiles")
    .select("*")
    .eq("id", user.id)
    .maybeSingle();

  if (profileError) {
    if (profileError.code === "PGRST116") {
      return {
        profile: buildProfileFromMetadata(user),
        profileError: null
      };
    }

    return {
      profile: null,
      profileError
    };
  }

  return {
    profile: profile || buildProfileFromMetadata(user),
    profileError: null
  };
}

async function ensureRoleSession(role) {
  const cachedSession = getSession();
  const normalizedRole = String(role || "").toLowerCase();
  const client = window.supabaseClient || null;

  if (cachedSession && cachedSession.role?.toLowerCase() === normalizedRole && ["teacher", "student"].includes(normalizedRole)) {
    setSession(cachedSession);
    return cachedSession;
  }

  if (!client || !client.auth) {
    console.error("Supabase client is not ready.");
    window.location.href = "index.html";
    return null;
  }

  const {
    data: { user },
    error: userError
  } = await client.auth.getUser();

  if (userError || !user) {
    if (userError) {
      console.error("Unable to validate auth session:", userError);
    }
    await signOutAndClearSession();
    window.location.href = "index.html";
    return null;
  }

  const { profile, profileError } = await loadEffectiveProfile(user);

  if (profileError) {
    console.error("Unable to validate profile:", profileError);
    await signOutAndClearSession();
    window.location.href = "index.html";
    return null;
  }

  if (!profile || profile.role?.toLowerCase() !== normalizedRole) {
    await signOutAndClearSession();
    window.location.href = "index.html";
    return null;
  }

  const session = {
    ...(cachedSession || {}),
    role: profile.role,
    id: user.id,
    email: user.email || cachedSession?.email || "",
    name: profile.name || cachedSession?.name || user.email || "",
    teacherRecordId: cachedSession?.teacherRecordId || profile.teacher_id || null,
    teacherId: cachedSession?.teacherId || profile.teacher_code || "",
    studentRecordId: cachedSession?.studentRecordId || profile.student_id || null
  };

  setSession(session);
  return session;
}
