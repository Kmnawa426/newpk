function normalizeText(value) {
  return String(value || "").trim().replace(/\s+/g, " ");
}

function normalizeSection(value) {
  return normalizeText(value).toUpperCase();
}

function normalizeEmail(value) {
  return normalizeText(value).toLowerCase();
}

function normalizeLanguage(value) {
  const normalized = normalizeText(value).toLowerCase();
  if (normalized === "sanskrit") {
    return "samskrutha";
  }
  return normalized;
}

function formatClassName(value) {
  return normalizeText(value).toUpperCase();
}

function formatName(value) {
  return normalizeText(value)
    .toLowerCase()
    .split(" ")
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

function displayLanguage(value) {
  const normalized = normalizeLanguage(value);
  if (!normalized) {
    return "";
  }
  return normalized.charAt(0).toUpperCase() + normalized.slice(1);
}

function isValidEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizeEmail(value));
}

function isStrongPassword(value) {
  return String(value || "").length >= 6;
}

function isValidName(value) {
  return /^[A-Za-z][A-Za-z\s.'-]{1,59}$/.test(normalizeText(value));
}

function isValidClassName(value) {
  return /^[A-Za-z0-9][A-Za-z0-9\s/-]{0,29}$/.test(normalizeText(value));
}

function isValidIdentifier(value) {
  return /^[A-Za-z0-9_@.-]{3,30}$/.test(normalizeText(value));
}

function isLanguageSubject(subject) {
  return ["kannada", "hindi", "samskrutha", "sanskrit"].includes(normalizeLanguage(subject));
}

function isImportedRosterStudent(student) {
  return !student?.access_requested && !student?.access_granted && !normalizeText(student?.email) && !normalizeText(student?.password);
}

function isEligibleForAttendance(student, subject) {
  if (!student) {
    return false;
  }

  const approvedOrImported = student.access_granted === true || isImportedRosterStudent(student);
  if (!approvedOrImported) {
    return false;
  }

  if (!isLanguageSubject(subject)) {
    return true;
  }

  return normalizeLanguage(student.language) === normalizeLanguage(subject);
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => {
    const entities = {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;"
    };
    return entities[char];
  });
}

function sortByLabel(items, getLabel) {
  return [...items].sort((a, b) => getLabel(a).localeCompare(getLabel(b)));
}
