async function login() {
  const role = document.getElementById("role").value;
  const email = normalizeEmail(document.getElementById("email").value);
  const password = document.getElementById("password").value;

  if (!email || !password) {
    alert("Enter both email and password.");
    return;
  }

  if (role === "admin") {
    const { data, error } = await supabaseClient.auth.signInWithPassword({
      email,
      password
    });

    if (error) {
      alert("Invalid admin credentials");
      return;
    }

    const user = data.user;

    const { data: profile } = await db
      .from("profiles")
      .select("*")
      .eq("id", user.id)
      .maybeSingle();

    if (!profile || profile.role !== "admin") {
      alert("Not an admin");
      return;
    }

    setSession({
      role: "admin",
      id: user.id,
      name: profile.name,
      email: user.email || email
    });

    window.location.href = "admin.html";
    return;
  }

  if (role === "teacher") {
    const teacherId = normalizeText(email).toLowerCase();

    const { data: teacher, error } = await db
      .from("teachers")
      .select("*")
      .eq("teacher_id", teacherId)
      .eq("password", password)
      .maybeSingle();

    if (error || !teacher) {
      alert("Invalid teacher credentials");
      return;
    }

    setSession({
      role: "teacher",
      id: teacher.id,
      teacherId: teacher.teacher_id,
      name: teacher.name,
      teacherRecordId: teacher.id
    });

    window.location.href = "teacher.html";
    return;
  }

  if (role === "student") {
    const { data: student, error } = await db
      .from("students")
      .select("*")
      .eq("email", email)
      .eq("password", password)
      .maybeSingle();

    if (error || !student) {
      alert("Invalid student credentials");
      return;
    }

    setSession({
      role: "student",
      id: student.id,
      email: student.email,
      name: student.name
    });

    window.location.href = "student.html";
  }
}

function updateLoginLabels() {
  const role = document.getElementById("role").value;
  const emailLabel = document.getElementById("emailLabel");
  const emailInput = document.getElementById("email");
  const hint = document.getElementById("loginHint");

  if (role === "teacher") {
    emailLabel.textContent = "Teacher ID";
    emailInput.type = "text";
    emailInput.placeholder = "Enter teacher ID";
    hint.textContent = "Teachers login using the Teacher ID created by admin and their password.";
    return;
  }

  emailLabel.textContent = "Email";
  emailInput.type = "email";
  emailInput.placeholder = role === "student" ? "Enter your registered student email" : "Enter your admin email";
  hint.textContent = role === "student"
    ? "Students login with the email and password used during access request."
    : "Admins login with their Supabase email and password.";
}

function bindAuthEvents() {
  const loginBtn = document.getElementById("loginBtn");
  loginBtn.dataset.busyText = "Logging in...";
  loginBtn.addEventListener("click", (event) => runLockedAction("login", login, event.currentTarget));
  document.getElementById("role").addEventListener("change", updateLoginLabels);
  document.getElementById("password").addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      runLockedAction("login", login, loginBtn);
    }
  });

  updateLoginLabels();
}

bindAuthEvents();
