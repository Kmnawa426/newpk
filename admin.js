let adminSession = null;
const adminState = {
  classrooms: [],
  teachers: [],
  assignments: [],
  students: [],
  classroomMap: new Map(),
  teacherMap: new Map(),
  selectedStudentClassroomId: "all",
  studentPage: 1,
  studentPageSize: 10,
  reportRows: [],
  reportHeaders: []
};

function classroomLabel(classroom) {
  const section = normalizeSection(classroom.section);
  return section ? `${classroom.class_name} - ${section}` : classroom.class_name;
}

function adminAssignmentLabel(assignment) {
  const teacher = adminState.teacherMap.get(assignment.teacher_id);
  const classroom = adminState.classroomMap.get(assignment.classroom_id);
  const teacherName = teacher ? teacher.name : "Teacher";
  const classLabel = classroom ? classroomLabel(classroom) : "Classroom";
  return `${classLabel} - ${assignment.subject} (${teacherName})`;
}

function studentCountLabel(count) {
  return `${count} student${count === 1 ? "" : "s"}`;
}

function getClassroomStudentCount(classroomId) {
  return adminState.students.filter((student) => student.classroom_id === classroomId).length;
}

function setDashboardPanel(panelId) {
  document.querySelectorAll(".dashboard-panel").forEach((panel) => {
    panel.classList.toggle("active", panel.id === panelId);
  });

  document.querySelectorAll(".nav-tab").forEach((tab) => {
    tab.classList.toggle("active", tab.dataset.panel === panelId);
  });
}

async function loadAdminData() {
  const [
    classroomsResponse,
    teachersResponse,
    assignmentsResponse,
    studentsResponse
  ] = await Promise.all([
    db.from("classrooms").select("*"),
    db.from("teachers").select("*"),
    db.from("assignments").select("*"),
    db.from("students").select("*")
  ]);

  const responses = [classroomsResponse, teachersResponse, assignmentsResponse, studentsResponse];
  const failed = responses.find((response) => response.error);

  if (failed) {
    throw failed.error;
  }

  const classrooms = sortByLabel(classroomsResponse.data || [], classroomLabel);
  const teachers = sortByLabel(teachersResponse.data || [], (teacher) => `${teacher.name} ${teacher.teacher_id}`);
  const assignments = assignmentsResponse.data || [];
  const students = sortByLabel(studentsResponse.data || [], (student) => student.name);

  adminState.classrooms = classrooms;
  adminState.teachers = teachers;
  adminState.assignments = assignments;
  adminState.students = students;
  adminState.classroomMap = new Map(classrooms.map((classroom) => [classroom.id, classroom]));
  adminState.teacherMap = new Map(teachers.map((teacher) => [teacher.id, teacher]));

  const classroomIds = new Set(classrooms.map((classroom) => classroom.id));
  if (adminState.selectedStudentClassroomId !== "all" && !classroomIds.has(adminState.selectedStudentClassroomId)) {
    adminState.selectedStudentClassroomId = "all";
  }
}

function updateAdminSummary() {
  const pendingCount = adminState.students.filter((student) => student.access_requested && !student.access_granted).length;
  document.getElementById("classroomCount").textContent = String(adminState.classrooms.length);
  document.getElementById("teacherCount").textContent = String(adminState.teachers.length);
  document.getElementById("studentCount").textContent = String(adminState.students.length);
  document.getElementById("pendingCount").textContent = String(pendingCount);
}

function renderClassrooms() {
  const body = document.getElementById("classroomTableBody");

  if (!adminState.classrooms.length) {
    body.innerHTML = `<tr><td colspan="4" class="empty">No classrooms created.</td></tr>`;
    return;
  }

  body.innerHTML = adminState.classrooms
    .map(
      (classroom, index) => `
        <tr>
          <td>${index + 1}</td>
          <td>${escapeHtml(classroom.class_name)}</td>
          <td>${escapeHtml(normalizeSection(classroom.section) || "-")}</td>
          <td><button class="small danger" data-busy-text="Removing..." onclick="runLockedAction('remove-classroom-${classroom.id}', () => removeClassroom('${classroom.id}'), this)">Remove</button></td>
        </tr>
      `
    )
    .join("");
}

function renderTeachers() {
  const body = document.getElementById("teacherTableBody");

  if (!adminState.teachers.length) {
    body.innerHTML = `<tr><td colspan="4" class="empty">No teachers found.</td></tr>`;
    return;
  }

  body.innerHTML = adminState.teachers
    .map(
      (teacher, index) => `
        <tr>
          <td>${index + 1}</td>
          <td>${escapeHtml(teacher.name)}</td>
          <td>${escapeHtml(teacher.teacher_id)}</td>
          <td><button class="small ghost" data-busy-text="Deleting..." onclick="runLockedAction('delete-teacher-${teacher.id}', () => deleteTeacher('${teacher.id}'), this)">Delete</button></td>
        </tr>
      `
    )
    .join("");
}

function renderDropdowns() {
  const teacherSelect = document.getElementById("assignTeacher");
  const classroomSelect = document.getElementById("assignClassroom");
  const importClassroomSelect = document.getElementById("importClassroom");
  const studentClassFilter = document.getElementById("studentClassFilter");

  teacherSelect.innerHTML = adminState.teachers.length
    ? adminState.teachers
        .map(
          (teacher) =>
            `<option value="${teacher.id}">${escapeHtml(teacher.name)} (${escapeHtml(teacher.teacher_id)})</option>`
        )
        .join("")
    : `<option value="">No teachers found</option>`;

  const classroomOptions = adminState.classrooms.length
    ? adminState.classrooms
        .map((classroom) => {
          const count = getClassroomStudentCount(classroom.id);
          return `<option value="${classroom.id}">${escapeHtml(`${classroomLabel(classroom)} - ${studentCountLabel(count)}`)}</option>`;
        })
        .join("")
    : `<option value="">No classrooms found</option>`;

  classroomSelect.innerHTML = classroomOptions;
  importClassroomSelect.innerHTML = classroomOptions;

  studentClassFilter.innerHTML = [
    `<option value="all">All classrooms</option>`,
    ...adminState.classrooms.map(
      (classroom) => {
        const count = getClassroomStudentCount(classroom.id);
        return `<option value="${classroom.id}">${escapeHtml(`${classroomLabel(classroom)} - ${studentCountLabel(count)}`)}</option>`;
      }
    )
  ].join("");

  if ((!adminState.selectedStudentClassroomId || adminState.selectedStudentClassroomId === "all") && importClassroomSelect.value) {
    adminState.selectedStudentClassroomId = importClassroomSelect.value;
  }

  if (adminState.selectedStudentClassroomId !== "all") {
    importClassroomSelect.value = adminState.selectedStudentClassroomId;
  }

  studentClassFilter.value = adminState.selectedStudentClassroomId;
}

function renderAssignments() {
  const body = document.getElementById("assignmentTableBody");

  if (!adminState.assignments.length) {
    body.innerHTML = `<tr><td colspan="6" class="empty">No teaching plans yet.</td></tr>`;
    return;
  }

  body.innerHTML = adminState.assignments
    .map((assignment, index) => {
      const teacher = adminState.teacherMap.get(assignment.teacher_id);
      const classroom = adminState.classroomMap.get(assignment.classroom_id);

      return `
        <tr>
          <td>${index + 1}</td>
          <td>${escapeHtml(teacher ? teacher.name : "-")}</td>
          <td>${escapeHtml(teacher ? teacher.teacher_id : "-")}</td>
          <td>${escapeHtml(classroom ? classroom.class_name : "-")}</td>
          <td>${escapeHtml(classroom ? normalizeSection(classroom.section) || "-" : "-")}</td>
          <td>${escapeHtml(assignment.subject)}</td>
        </tr>
      `;
    })
    .join("");
}

function getFilteredStudents() {
  if (adminState.selectedStudentClassroomId === "all") {
    return adminState.students;
  }

  return adminState.students.filter((student) => student.classroom_id === adminState.selectedStudentClassroomId);
}

function renderStudents() {
  const body = document.getElementById("studentTableBody");
  const info = document.getElementById("studentPaginationInfo");
  const summary = document.getElementById("studentFilterSummary");
  const prevBtn = document.getElementById("studentPrevPage");
  const nextBtn = document.getElementById("studentNextPage");

  const filtered = getFilteredStudents();
  const totalPages = Math.max(1, Math.ceil(filtered.length / adminState.studentPageSize));
  adminState.studentPage = Math.min(adminState.studentPage, totalPages);
  adminState.studentPage = Math.max(1, adminState.studentPage);

  const startIndex = (adminState.studentPage - 1) * adminState.studentPageSize;
  const pagedStudents = filtered.slice(startIndex, startIndex + adminState.studentPageSize);
  const selectedClassroom = adminState.classroomMap.get(adminState.selectedStudentClassroomId);

  summary.textContent = selectedClassroom
    ? `Showing ${filtered.length} student${filtered.length === 1 ? "" : "s"} from ${classroomLabel(selectedClassroom)}.`
    : `Showing ${filtered.length} student${filtered.length === 1 ? "" : "s"} across all classrooms.`;

  if (!pagedStudents.length) {
    body.innerHTML = `<tr><td colspan="8" class="empty">No students added for the selected classroom.</td></tr>`;
  } else {
    body.innerHTML = pagedStudents
      .map((student, index) => {
        const classroom = adminState.classroomMap.get(student.classroom_id);
        const accessText = student.access_granted
          ? "Granted"
          : student.access_requested
            ? "Pending"
            : "Not Requested";

        return `
          <tr>
            <td>${startIndex + index + 1}</td>
            <td>${escapeHtml(student.name)}</td>
            <td>${escapeHtml(classroom ? classroom.class_name : "-")}</td>
            <td>${escapeHtml(classroom ? normalizeSection(classroom.section) || "-" : "-")}</td>
            <td>${escapeHtml(displayLanguage(student.language))}</td>
            <td>${escapeHtml(student.email || "-")}</td>
            <td>${escapeHtml(accessText)}</td>
            <td><button class="small ghost" data-busy-text="Removing..." onclick="runLockedAction('remove-student-${student.id}', () => removeStudent('${student.id}'), this)">Remove</button></td>
          </tr>
        `;
      })
      .join("");
  }

  info.textContent = `Page ${adminState.studentPage} of ${totalPages}`;
  prevBtn.disabled = adminState.studentPage <= 1;
  nextBtn.disabled = adminState.studentPage >= totalPages;

}

function renderPendingAccess() {
  const body = document.getElementById("pendingAccessBody");
  const pending = adminState.students.filter((student) => student.access_requested && !student.access_granted);

  if (!pending.length) {
    body.innerHTML = `<tr><td colspan="7" class="empty">No pending requests.</td></tr>`;
    return;
  }

  body.innerHTML = pending
    .map((student, index) => {
      const classroom = adminState.classroomMap.get(student.classroom_id);

      return `
        <tr>
          <td>${index + 1}</td>
          <td>${escapeHtml(student.name)}</td>
          <td>${escapeHtml(student.email || "-")}</td>
          <td>${escapeHtml(classroom ? classroom.class_name : "-")}</td>
          <td>${escapeHtml(classroom ? normalizeSection(classroom.section) || "-" : "-")}</td>
          <td>${escapeHtml(displayLanguage(student.language))}</td>
          <td>
            <button class="small primary" data-busy-text="Granting..." onclick="runLockedAction('grant-access-${student.id}', () => grantAccess('${student.id}'), this)">Grant Access</button>
            <button class="small ghost" data-busy-text="Removing..." onclick="runLockedAction('remove-student-${student.id}', () => removeStudent('${student.id}'), this)">Remove</button>
          </td>
        </tr>
      `;
    })
    .join("");
}

function renderAdminReportOptions() {
  const select = document.getElementById("adminReportAssignmentSelect");
  if (!select) {
    return;
  }

  if (!adminState.assignments.length) {
    select.innerHTML = `<option value="">No teaching plans available</option>`;
    return;
  }

  select.innerHTML = adminState.assignments
    .map((assignment) => {
      const count = getAdminAssignmentStudents(assignment.classroom_id, assignment.subject).length;
      return `<option value="${assignment.id}">${escapeHtml(`${adminAssignmentLabel(assignment)} - ${studentCountLabel(count)}`)}</option>`;
    })
    .join("");
}

function formatReportDate(value, index) {
  if (!value) {
    return `Sheet ${index + 1}`;
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return String(value);
  }

  return parsed.toLocaleString(undefined, {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  });
}

function statusCell(status) {
  if (status === "present") {
    return `<span class="status-pill status-present">P</span>`;
  }

  if (status === "absent") {
    return `<span class="status-pill status-absent">A</span>`;
  }

  return `<span class="status-pill status-empty">-</span>`;
}

function getAdminAssignmentStudents(classroomId, subject) {
  const students = adminState.students.filter((student) => student.classroom_id === classroomId);
  return sortByLabel(students.filter((student) => isEligibleForAttendance(student, subject)), (student) => student.name);
}

async function loadAdminAttendanceReport() {
  const select = document.getElementById("adminReportAssignmentSelect");
  const summary = document.getElementById("adminAttendanceReportSummary");
  const head = document.getElementById("adminAttendanceMatrixHead");
  const body = document.getElementById("adminAttendanceMatrixBody");
  const assignmentId = select?.value;

  adminState.reportRows = [];
  adminState.reportHeaders = [];

  if (!assignmentId) {
    summary.textContent = "Choose a teaching plan to view attendance.";
    head.innerHTML = "";
    body.innerHTML = `<tr><td class="empty">No teaching plan selected.</td></tr>`;
    return;
  }

  const assignment = adminState.assignments.find((item) => item.id === assignmentId);
  if (!assignment) {
    alert("Teaching plan not found.");
    return;
  }

  const students = getAdminAssignmentStudents(assignment.classroom_id, assignment.subject);
  const { data: attendanceRows, error: attendanceError } = await db
    .from("attendance")
    .select("*")
    .eq("assignment_id", assignment.id);

  if (attendanceError) {
    throw attendanceError;
  }

  const sortedAttendance = [...(attendanceRows || [])].sort((a, b) => {
    const aDate = new Date(a.date || a.created_at || 0).getTime();
    const bDate = new Date(b.date || b.created_at || 0).getTime();
    return aDate - bDate;
  });
  const attendanceIds = sortedAttendance.map((row) => row.id).filter(Boolean);

  let recordRows = [];
  if (attendanceIds.length) {
    const { data, error } = await db
      .from("attendance_records")
      .select("*")
      .in("attendance_id", attendanceIds);

    if (error) {
      throw error;
    }

    recordRows = data || [];
  }

  const recordMap = new Map(recordRows.map((record) => [`${record.attendance_id}:${record.student_id}`, record.status]));
  const headers = sortedAttendance.map((attendance, index) => ({
    id: attendance.id,
    label: formatReportDate(attendance.date || attendance.created_at, index)
  }));

  adminState.reportHeaders = ["Student", ...headers.map((header) => header.label), "Total Present"];
  adminState.reportRows = students.map((student) => {
    const statuses = headers.map((header) => recordMap.get(`${header.id}:${student.id}`) || "");
    const totalPresent = statuses.filter((status) => status === "present").length;
    const percentage = headers.length ? (totalPresent / headers.length) * 100 : 0;
    return {
      name: student.name,
      statuses,
      totalPresent,
      percentage
    };
  });

  head.innerHTML = `
    <tr>
      <th>Student Name</th>
      ${headers.map((header) => `<th>${escapeHtml(header.label)}</th>`).join("")}
      <th>Total Present</th>
    </tr>
  `;

  if (!students.length) {
    body.innerHTML = `<tr><td colspan="${headers.length + 2}" class="empty">No eligible students for this teaching plan.</td></tr>`;
  } else if (!headers.length) {
    body.innerHTML = students
      .map(
        (student) => `
          <tr>
            <td><strong>${escapeHtml(student.name)}</strong></td>
            <td><span class="attendance-total" data-tooltip="Overall attendance: 0.00%">0</span></td>
          </tr>
        `
      )
      .join("");
  } else {
    body.innerHTML = adminState.reportRows
      .map(
        (row) => `
          <tr>
            <td><strong>${escapeHtml(row.name)}</strong></td>
            ${row.statuses.map((status) => `<td>${statusCell(status)}</td>`).join("")}
            <td><span class="attendance-total" data-tooltip="Overall attendance: ${row.percentage.toFixed(2)}%">${row.totalPresent}</span></td>
          </tr>
        `
      )
      .join("");
  }

  summary.textContent = `${adminAssignmentLabel(assignment)} - ${students.length} student${students.length === 1 ? "" : "s"}, ${headers.length} attendance date${headers.length === 1 ? "" : "s"}.`;
}

function exportAdminAttendanceReport() {
  if (!adminState.reportRows.length || !adminState.reportHeaders.length) {
    alert("Load an attendance report before exporting.");
    return;
  }

  const csvRows = [
    adminState.reportHeaders,
    ...adminState.reportRows.map((row) => [
      row.name,
      ...row.statuses.map((status) => (status === "present" ? "P" : status === "absent" ? "A" : "")),
      `${row.totalPresent} (${row.percentage.toFixed(2)}%)`
    ])
  ];

  const csv = csvRows
    .map((row) => row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(","))
    .join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "attendance-report.csv";
  link.click();
  URL.revokeObjectURL(url);
}

function renderAdminView() {
  updateAdminSummary();
  renderClassrooms();
  renderTeachers();
  renderDropdowns();
  renderAssignments();
  renderStudents();
  renderPendingAccess();
  renderAdminReportOptions();
}

async function refreshAdminView() {
  try {
    await loadAdminData();
    renderAdminView();
  } catch (error) {
    console.error("Failed to refresh admin view:", error);
    alert("Unable to load admin data right now.");
  }
}

function focusStudentClassroom(classroomId, panelId = "panelStudents") {
  adminState.selectedStudentClassroomId = classroomId;
  adminState.studentPage = 1;
  document.getElementById("studentClassFilter").value = classroomId;
  document.getElementById("importClassroom").value = classroomId;
  setDashboardPanel(panelId);
  renderStudents();
}

async function createClassroom() {
  const className = formatClassName(document.getElementById("className").value);
  const section = normalizeSection(document.getElementById("section").value);

  if (!className) {
    alert("Enter class.");
    return;
  }

  if (!isValidClassName(className)) {
    alert("Enter a valid class name.");
    return;
  }

  const { data: existing, error: existingError } = await db
    .from("classrooms")
    .select("id")
    .eq("class_name", className)
    .eq("section", section);

  if (existingError) {
    console.error("Classroom lookup failed:", existingError);
    alert("Unable to verify classroom right now.");
    return;
  }

  if (existing.length) {
    alert("Classroom already exists.");
    return;
  }

  const { error: insertError } = await db.from("classrooms").insert({
    class_name: className,
    section
  });

  if (insertError) {
    console.error("Classroom create failed:", insertError);
    alert(insertError.message.includes("duplicate") ? "Classroom already exists." : "Failed to create classroom.");
    return;
  }

  document.getElementById("className").value = "";
  document.getElementById("section").value = "";
  await refreshAdminView();
}

async function createTeacher() {
  const name = formatName(document.getElementById("teacherName").value);
  const teacherId = normalizeText(document.getElementById("teacherId").value).toLowerCase();
  const password = document.getElementById("teacherPassword").value;

  if (!name || !teacherId || !password) {
    alert("Enter teacher name, id, and password.");
    return;
  }

  if (!isValidName(name)) {
    alert("Enter a valid teacher name.");
    return;
  }

  if (!isValidIdentifier(teacherId)) {
    alert("Teacher ID should be 3-30 characters and use letters, numbers, ., -, _, or @.");
    return;
  }

  if (!isStrongPassword(password)) {
    alert("Password should be at least 6 characters.");
    return;
  }

  const { data: existing, error: existingError } = await db
    .from("teachers")
    .select("id")
    .eq("teacher_id", teacherId);

  if (existingError) {
    console.error("Teacher lookup failed:", existingError);
    alert("Unable to verify teacher right now.");
    return;
  }

  if (existing.length) {
    alert("Teacher ID already exists.");
    return;
  }

  const { error: insertError } = await db.from("teachers").insert({
    name,
    teacher_id: teacherId,
    password
  });

  if (insertError) {
    console.error("Teacher create failed:", insertError);
    alert(insertError.message.includes("duplicate") ? "Teacher ID already exists." : "Failed to create teacher.");
    return;
  }

  document.getElementById("teacherName").value = "";
  document.getElementById("teacherId").value = "";
  document.getElementById("teacherPassword").value = "";
  await refreshAdminView();
}

async function createAssignment() {
  const teacherId = document.getElementById("assignTeacher").value;
  const classroomId = document.getElementById("assignClassroom").value;
  const subjectInput = normalizeText(document.getElementById("assignSubject").value);
  const subject = isLanguageSubject(subjectInput) ? displayLanguage(subjectInput) : subjectInput;

  if (!teacherId || !classroomId || !subject) {
    alert("Choose teacher, classroom, and subject.");
    return;
  }

  if (subject.length < 2 || subject.length > 40) {
    alert("Subject should be between 2 and 40 characters.");
    return;
  }

  const { data: duplicate, error: duplicateError } = await db
    .from("assignments")
    .select("id")
    .eq("teacher_id", teacherId)
    .eq("classroom_id", classroomId)
    .ilike("subject", subject);

  if (duplicateError) {
    console.error("Assignment lookup failed:", duplicateError);
    alert("Unable to verify teaching plan right now.");
    return;
  }

  if (duplicate.length) {
    alert("Same teaching plan already exists.");
    return;
  }

  const { error: insertError } = await db.from("assignments").insert({
    teacher_id: teacherId,
    classroom_id: classroomId,
    subject
  });

  if (insertError) {
    console.error("Teaching plan create failed:", insertError);
    alert(insertError.message.includes("duplicate") ? "Same teaching plan already exists." : "Failed to create teaching plan.");
    return;
  }

  document.getElementById("assignSubject").value = "";
  await refreshAdminView();
}

function parseCSV(text) {
  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  if (!lines.length) {
    return [];
  }

  const headers = lines[0].split(",").map((header) => normalizeImportHeader(header));
  return lines.slice(1).map((line) => {
    const values = line.split(",").map((value) => value.trim());
    const row = {};
    headers.forEach((header, index) => {
      row[header] = values[index] || "";
    });
    return row;
  });
}

function normalizeImportHeader(header) {
  return normalizeText(header).toLowerCase().replace(/[\s_-]+/g, "");
}

function getImportValue(row, ...keys) {
  if (!row || typeof row !== "object") {
    return "";
  }

  const normalizedEntries = new Map(
    Object.entries(row).map(([key, value]) => [normalizeImportHeader(key), value])
  );

  for (const key of keys) {
    const normalizedKey = normalizeImportHeader(key);
    if (normalizedEntries.has(normalizedKey)) {
      return normalizedEntries.get(normalizedKey);
    }
  }

  return "";
}

function normalizeImportedRow(row, classroomId) {
  const name = formatName(getImportValue(row, "name", "studentname", "student"));
  const language = normalizeLanguage(getImportValue(row, "lang", "language", "subjectlanguage"));

  if (!isValidName(name) || !language) {
    return null;
  }

  return {
    name,
    classroom_id: classroomId,
    language,
    email: null,
    password: null,
    access_requested: false,
    access_granted: false
  };
}

async function saveImportedRows(rows, classroomId) {
  const prepared = rows.map((row) => normalizeImportedRow(row, classroomId)).filter(Boolean);

  if (!prepared.length) {
    alert("No valid rows found. Required columns: name, lang.");
    return;
  }

  const { data: existingRows, error: existingError } = await db
    .from("students")
    .select("name, classroom_id, language")
    .eq("classroom_id", classroomId);

  if (existingError) {
    console.error("Student import lookup failed:", existingError);
    alert("Unable to verify existing students right now.");
    return;
  }

  const existingKeys = new Set(
    (existingRows || []).map(
      (student) => `${normalizeText(student.name).toLowerCase()}::${student.classroom_id}::${normalizeLanguage(student.language)}`
    )
  );

  const inserts = prepared.filter((student) => {
    const key = `${student.name.toLowerCase()}::${student.classroom_id}::${normalizeLanguage(student.language)}`;
    if (existingKeys.has(key)) {
      return false;
    }
    existingKeys.add(key);
    return true;
  });

  if (!inserts.length) {
    alert("No new students to import. All rows already exist.");
    return;
  }

  const { error: insertError } = await db.from("students").insert(inserts);

  if (insertError) {
    console.error("Student import failed:", insertError);
    alert(insertError.message.includes("duplicate") ? "Some students already exist." : "Failed to import students.");
    return;
  }

  alert(`Imported ${inserts.length} students.`);
  document.getElementById("studentFile").value = "";
  adminState.selectedStudentClassroomId = classroomId;
  adminState.studentPage = 1;
  await refreshAdminView();
}

async function importStudents() {
  const classroomId = document.getElementById("importClassroom").value;
  const fileInput = document.getElementById("studentFile");
  const file = fileInput.files[0];

  if (!classroomId) {
    alert("Select a classroom for import.");
    return;
  }

  if (!file) {
    alert("Choose a file first.");
    return;
  }

  const extension = file.name.split(".").pop().toLowerCase();

  if (extension === "csv") {
    await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = async () => {
        try {
          const rows = parseCSV(String(reader.result || ""));
          await saveImportedRows(rows, classroomId);
          resolve();
        } catch (error) {
          reject(error);
        }
      };
      reader.onerror = () => reject(reader.error || new Error("Failed to read CSV file."));
      reader.readAsText(file);
    });
    return;
  }

  if (["xlsx", "xls"].includes(extension)) {
    if (typeof XLSX === "undefined") {
      alert("Excel parser failed to load. Use CSV or check internet once for CDN.");
      return;
    }

    await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = async (event) => {
        try {
          const data = new Uint8Array(event.target.result);
          const workbook = XLSX.read(data, { type: "array" });
          const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
          const rows = XLSX.utils.sheet_to_json(firstSheet, { raw: false, defval: "" });
          await saveImportedRows(rows, classroomId);
          resolve();
        } catch (error) {
          reject(error);
        }
      };
      reader.onerror = () => reject(reader.error || new Error("Failed to read Excel file."));
      reader.readAsArrayBuffer(file);
    });
    return;
  }

  alert("Unsupported format. Use .xlsx, .xls, or .csv.");
}

async function grantAccess(studentId) {
  const { error } = await db
    .from("students")
    .update({
      access_requested: true,
      access_granted: true
    })
    .eq("id", studentId);

  if (error) {
    console.error("Grant access failed:", error);
    alert("Failed to grant student access.");
    return;
  }

  await refreshAdminView();
}

async function removeStudent(studentId) {
  const ok = await showConfirmDialog("Remove this student from the system?", {
    title: "Remove Student",
    confirmText: "Remove"
  });
  if (!ok) {
    return;
  }

  const { error } = await db.from("students").delete().eq("id", studentId);

  if (error) {
    console.error("Student delete failed:", error);
    alert("Failed to remove student.");
    return;
  }

  await refreshAdminView();
}

async function removeClassroom(classroomId) {
  const classroom = adminState.classroomMap.get(classroomId);
  const className = classroom ? classroomLabel(classroom) : "this class";
  const studentCount = adminState.students.filter((student) => student.classroom_id === classroomId).length;
  const planCount = adminState.assignments.filter((assignment) => assignment.classroom_id === classroomId).length;

  const ok = await showConfirmDialog(
    `Remove ${className}? This will also remove ${studentCount} student${studentCount === 1 ? "" : "s"}, ${planCount} teaching plan${planCount === 1 ? "" : "s"}, and related attendance records.`,
    {
      title: "Remove Class",
      confirmText: "Remove Class"
    }
  );
  if (!ok) {
    return;
  }

  const { data: attendanceRows, error: attendanceLookupError } = await db
    .from("attendance")
    .select("id")
    .eq("classroom_id", classroomId);

  if (attendanceLookupError) {
    console.error("Class attendance lookup failed:", attendanceLookupError);
    alert("Unable to verify attendance records for this class.");
    return;
  }

  const attendanceIds = (attendanceRows || []).map((row) => row.id);
  if (attendanceIds.length) {
    const { error: recordsError } = await db.from("attendance_records").delete().in("attendance_id", attendanceIds);
    if (recordsError) {
      console.error("Attendance record cleanup failed:", recordsError);
      alert("Failed to remove class attendance records.");
      return;
    }

    const { error: attendanceError } = await db.from("attendance").delete().in("id", attendanceIds);
    if (attendanceError) {
      console.error("Attendance cleanup failed:", attendanceError);
      alert("Failed to remove class attendance sheets.");
      return;
    }
  }

  const { error: studentError } = await db.from("students").delete().eq("classroom_id", classroomId);
  if (studentError) {
    console.error("Class student cleanup failed:", studentError);
    alert("Failed to remove students for this class.");
    return;
  }

  const { error: planError } = await db.from("assignments").delete().eq("classroom_id", classroomId);
  if (planError) {
    console.error("Class teaching plan cleanup failed:", planError);
    alert("Failed to remove teaching plans for this class.");
    return;
  }

  const { error: classError } = await db.from("classrooms").delete().eq("id", classroomId);
  if (classError) {
    console.error("Classroom delete failed:", classError);
    alert("Failed to remove class.");
    return;
  }

  adminState.selectedStudentClassroomId = "all";
  adminState.studentPage = 1;
  await refreshAdminView();
}

async function deleteTeacher(teacherId) {
  if (!adminSession?.email) {
    alert("Admin session expired. Please login again.");
    await signOutAndClearSession();
    window.location.href = "index.html";
    return;
  }

  const password = window.prompt("Enter admin password to delete this teacher:");
  if (!password) {
    return;
  }

  const adminEmail = adminSession.email;
  if (!adminEmail) {
    alert("Admin email is missing from the current session. Please login again.");
    return;
  }

  const { error: verifyError } = await window.supabaseClient.auth.signInWithPassword({
    email: adminEmail,
    password
  });

  if (verifyError) {
    alert("Incorrect admin password.");
    return;
  }

  const confirmDelete = await showConfirmDialog("Delete this teacher? Existing teaching plans may also need cleanup.", {
    title: "Delete Teacher",
    confirmText: "Delete"
  });
  if (!confirmDelete) {
    return;
  }

  const { data: assignments, error: assignmentError } = await db
    .from("assignments")
    .select("id")
    .eq("teacher_id", teacherId);

  if (assignmentError) {
    console.error("Teacher teaching plan lookup failed:", assignmentError);
    alert("Unable to verify teacher teaching plans.");
    return;
  }

  if (assignments.length) {
    const assignmentIds = assignments.map((assignment) => assignment.id);
    const { data: attendanceRows, error: attendanceLookupError } = await db
      .from("attendance")
      .select("id")
      .in("assignment_id", assignmentIds);

    if (attendanceLookupError) {
      console.error("Attendance lookup failed:", attendanceLookupError);
      alert("Unable to verify teacher attendance records.");
      return;
    }

    const attendanceIds = (attendanceRows || []).map((row) => row.id);
    if (attendanceIds.length) {
      await db.from("attendance_records").delete().in("attendance_id", attendanceIds);
      await db.from("attendance").delete().in("id", attendanceIds);
    }

    await db.from("assignments").delete().in("id", assignmentIds);
  }

  const { error } = await db.from("teachers").delete().eq("id", teacherId);

  if (error) {
    console.error("Teacher delete failed:", error);
    alert("Failed to delete teacher.");
    return;
  }

  await refreshAdminView();
}

function bindAdminEvents() {
  document.querySelectorAll(".nav-tab").forEach((tab) => {
    tab.addEventListener("click", () => setDashboardPanel(tab.dataset.panel));
  });

  const createClassroomBtn = document.getElementById("createClassroomBtn");
  const createTeacherBtn = document.getElementById("createTeacherBtn");
  const assignBtn = document.getElementById("assignBtn");
  const importBtn = document.getElementById("importBtn");
  const loadReportBtn = document.getElementById("adminLoadReportBtn");
  const exportReportBtn = document.getElementById("adminExportReportBtn");

  createClassroomBtn.dataset.busyText = "Adding...";
  createTeacherBtn.dataset.busyText = "Adding...";
  assignBtn.dataset.busyText = "Saving...";
  importBtn.dataset.busyText = "Importing...";
  loadReportBtn.dataset.busyText = "Loading...";
  exportReportBtn.dataset.busyText = "Exporting...";

  createClassroomBtn.addEventListener("click", (event) => runLockedAction("create-classroom", createClassroom, event.currentTarget));
  createTeacherBtn.addEventListener("click", (event) => runLockedAction("create-teacher", createTeacher, event.currentTarget));
  assignBtn.addEventListener("click", (event) => runLockedAction("create-teaching-plan", createAssignment, event.currentTarget));
  importBtn.addEventListener("click", (event) => {
    runLockedAction("import-students", importStudents, event.currentTarget).catch((error) => {
      console.error("Student import failed:", error);
      alert("Failed to import students.");
    });
  });
  loadReportBtn.addEventListener("click", (event) => {
    runLockedAction("admin-load-report", loadAdminAttendanceReport, event.currentTarget).catch((error) => {
      console.error("Admin attendance report failed:", error);
      alert("Unable to load attendance report.");
    });
  });
  exportReportBtn.addEventListener("click", (event) => runLockedAction("admin-export-report", exportAdminAttendanceReport, event.currentTarget));
  document.getElementById("teacherName").addEventListener("blur", (event) => {
    event.target.value = formatName(event.target.value);
  });
  document.getElementById("className").addEventListener("blur", (event) => {
    event.target.value = formatClassName(event.target.value);
  });
  document.getElementById("importClassroom").addEventListener("change", (event) => {
    adminState.selectedStudentClassroomId = event.target.value || "all";
    document.getElementById("studentClassFilter").value = adminState.selectedStudentClassroomId;
    adminState.studentPage = 1;
    renderStudents();
  });
  document.getElementById("studentClassFilter").addEventListener("change", (event) => {
    adminState.selectedStudentClassroomId = event.target.value;
    if (event.target.value !== "all") {
      document.getElementById("importClassroom").value = event.target.value;
    }
    adminState.studentPage = 1;
    renderStudents();
  });
  document.getElementById("studentPageSize").addEventListener("change", (event) => {
    adminState.studentPageSize = Number(event.target.value) || 10;
    adminState.studentPage = 1;
    renderStudents();
  });
  document.getElementById("studentPrevPage").addEventListener("click", () => {
    adminState.studentPage = Math.max(1, adminState.studentPage - 1);
    renderStudents();
  });
  document.getElementById("studentNextPage").addEventListener("click", () => {
    adminState.studentPage += 1;
    renderStudents();
  });
  document.getElementById("logoutBtn").addEventListener("click", () => {
    signOutAndClearSession().finally(() => {
      window.location.href = "index.html";
    });
  });
  window.addEventListener("focus", () => {
    refreshAdminView().catch((error) => {
      console.error("Admin refresh on focus failed:", error);
    });
  });
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState !== "visible") {
      return;
    }

    refreshAdminView().catch((error) => {
      console.error("Admin refresh on visibility change failed:", error);
    });
  });
}

window.grantAccess = grantAccess;
window.removeStudent = removeStudent;
window.removeClassroom = removeClassroom;
window.deleteTeacher = deleteTeacher;
window.focusStudentClassroom = focusStudentClassroom;

async function initAdminPage() {
  adminSession = await ensureRoleSession("admin");
  if (!adminSession) {
    return;
  }

  bindAdminEvents();
  await refreshAdminView();
}

initAdminPage();
