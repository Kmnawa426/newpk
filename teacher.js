let teacherSession = null;
const teacherState = {
  assignments: [],
  classroomMap: new Map(),
  studentCountByAssignmentId: new Map(),
  readyStudentCount: 0,
  reportRows: [],
  reportHeaders: []
};

const currentAssignmentState = {
  assignmentId: null,
  classroomId: null,
  subject: "",
  students: [],
  classroom: null
};

function classroomLabel(classroom) {
  const section = normalizeSection(classroom.section);
  return section ? `${classroom.class_name} - ${section}` : classroom.class_name;
}

function assignmentLabel(assignment) {
  const classroom = teacherState.classroomMap.get(assignment.classroom_id);
  const classLabel = classroom ? classroomLabel(classroom) : "Classroom";
  return `${classLabel} - ${assignment.subject}`;
}

function studentCountLabel(count) {
  return `${count} student${count === 1 ? "" : "s"}`;
}

function getAttendanceButtonId(studentId) {
  return `attendance_status_${studentId}`;
}

function setAttendanceButtonState(button, status) {
  if (!button) {
    return;
  }

  const normalizedStatus = status === "absent" ? "absent" : "present";
  button.dataset.status = normalizedStatus;
  button.textContent = normalizedStatus === "absent" ? "Absent" : "Present";
  button.classList.toggle("attendance-toggle-absent", normalizedStatus === "absent");
  button.setAttribute("aria-pressed", normalizedStatus === "absent" ? "true" : "false");
}

function toggleAttendanceStatus(studentId) {
  const button = document.getElementById(getAttendanceButtonId(studentId));
  if (!button) {
    return;
  }

  setAttendanceButtonState(button, button.dataset.status === "absent" ? "present" : "absent");
}

function setTeacherPanel(panelId) {
  document.querySelectorAll(".dashboard-panel").forEach((panel) => {
    panel.classList.toggle("active", panel.id === panelId);
  });

  document.querySelectorAll(".nav-tab").forEach((tab) => {
    tab.classList.toggle("active", tab.dataset.panel === panelId);
  });
}

async function getTeacherAssignments() {
  if (!teacherSession) {
    throw new Error("Teacher session is not available.");
  }

  const teacherRecordId = teacherSession.teacherRecordId || teacherSession.id;
  const { data, error } = await db
    .from("assignments")
    .select("*")
    .eq("teacher_id", teacherRecordId);

  if (error) {
    throw error;
  }

  return data || [];
}

async function getClassroomMap() {
  const { data, error } = await db.from("classrooms").select("*");

  if (error) {
    throw error;
  }

  return new Map((data || []).map((classroom) => [classroom.id, classroom]));
}

async function getAssignmentStudents(classroomId, subject) {
  const { data, error } = await db
    .from("students")
    .select("*")
    .eq("classroom_id", classroomId);

  if (error) {
    throw error;
  }

  const eligibleStudents = (data || []).filter((student) => isEligibleForAttendance(student, subject));
  return sortByLabel(eligibleStudents, (student) => student.name);
}

async function updateTeacherSummary() {
  document.getElementById("assignedCount").textContent = String(teacherState.assignments.length);

  const classroomIds = [...new Set(teacherState.assignments.map((assignment) => assignment.classroom_id))];
  if (!classroomIds.length) {
    teacherState.readyStudentCount = 0;
    document.getElementById("readyStudentCount").textContent = "0";
    return;
  }

  const { data, error } = await db
    .from("students")
    .select("id, classroom_id, language, access_requested, access_granted, email, password")
    .in("classroom_id", classroomIds);

  if (error) {
    throw error;
  }

  teacherState.studentCountByAssignmentId = new Map();
  teacherState.assignments.forEach((assignment) => {
    const count = (data || []).filter(
      (student) => assignment.classroom_id === student.classroom_id && isEligibleForAttendance(student, assignment.subject)
    ).length;
    teacherState.studentCountByAssignmentId.set(assignment.id, count);
  });

  const readyStudents = (data || []).filter((student) =>
    teacherState.assignments.some((assignment) =>
      assignment.classroom_id === student.classroom_id && isEligibleForAttendance(student, assignment.subject)
    )
  );

  teacherState.readyStudentCount = readyStudents.length;
  document.getElementById("readyStudentCount").textContent = String(readyStudents.length);
}

function renderAssignedClasses() {
  const body = document.getElementById("assignedClassesBody");

  if (!teacherState.assignments.length) {
    body.innerHTML = `<tr><td colspan="5" class="empty">No classes assigned by admin.</td></tr>`;
    return;
  }

  body.innerHTML = teacherState.assignments
    .map((assignment, index) => {
      const classroom = teacherState.classroomMap.get(assignment.classroom_id);
      return `
        <tr>
          <td>${index + 1}</td>
          <td>${escapeHtml(classroom ? classroom.class_name : "-")}</td>
          <td>${escapeHtml(classroom ? normalizeSection(classroom.section) || "-" : "-")}</td>
          <td>${escapeHtml(assignment.subject)}</td>
          <td><button class="small primary" data-busy-text="Opening..." onclick="runLockedAction('open-attendance-${assignment.id}', () => openAttendance('${assignment.id}'), this)">Open</button></td>
        </tr>
      `;
    })
    .join("");
}

function renderReportOptions() {
  const select = document.getElementById("reportAssignmentSelect");
  if (!select) {
    return;
  }

  if (!teacherState.assignments.length) {
    select.innerHTML = `<option value="">No classes available</option>`;
    return;
  }

  select.innerHTML = teacherState.assignments
    .map((assignment) => {
      const count = teacherState.studentCountByAssignmentId.get(assignment.id) || 0;
      return `<option value="${assignment.id}">${escapeHtml(`${assignmentLabel(assignment)} - ${studentCountLabel(count)}`)}</option>`;
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

function getSelectedAttendanceDate() {
  const input = document.getElementById("attendanceDate");
  const selected = input?.value;
  if (selected) {
    return selected;
  }

  return new Date().toISOString().slice(0, 10);
}

function getSelectedAttendanceTime() {
  const input = document.getElementById("attendanceTime");
  const selected = input?.value;
  if (selected) {
    return selected;
  }

  return "09:00";
}

function getAttendanceTimestamp(dateValue, timeValue) {
  return new Date(`${dateValue}T${timeValue}:00`).toISOString();
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

async function loadAttendanceReport() {
  const select = document.getElementById("reportAssignmentSelect");
  const summary = document.getElementById("attendanceReportSummary");
  const head = document.getElementById("attendanceMatrixHead");
  const body = document.getElementById("attendanceMatrixBody");
  const assignmentId = select?.value;

  teacherState.reportRows = [];
  teacherState.reportHeaders = [];

  if (!assignmentId) {
    summary.textContent = "Choose a class to view its attendance report.";
    head.innerHTML = "";
    body.innerHTML = `<tr><td class="empty">No class selected.</td></tr>`;
    return;
  }

  const assignment = teacherState.assignments.find((item) => item.id === assignmentId);
  if (!assignment) {
    alert("Teaching plan not found.");
    return;
  }

  const students = await getAssignmentStudents(assignment.classroom_id, assignment.subject);
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

  teacherState.reportHeaders = ["Student", ...headers.map((header) => header.label), "Total Present"];
  teacherState.reportRows = students.map((student) => {
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
    body.innerHTML = `<tr><td colspan="${headers.length + 2}" class="empty">No eligible students for this class.</td></tr>`;
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
    body.innerHTML = teacherState.reportRows
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

  summary.textContent = `${assignmentLabel(assignment)} - ${students.length} student${students.length === 1 ? "" : "s"}, ${headers.length} attendance date${headers.length === 1 ? "" : "s"}.`;
}

function exportAttendanceReport() {
  if (!teacherState.reportRows.length || !teacherState.reportHeaders.length) {
    alert("Load an attendance report before exporting.");
    return;
  }

  const csvRows = [
    teacherState.reportHeaders,
    ...teacherState.reportRows.map((row) => [
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

async function openAttendance(assignmentId) {
  try {
    const assignment = teacherState.assignments.find((item) => item.id === assignmentId);

    if (!assignment) {
      alert("Teaching plan not found.");
      return;
    }

    const classroom = teacherState.classroomMap.get(assignment.classroom_id);
    if (!classroom) {
      alert("Classroom not found for this teaching plan.");
      return;
    }

    const students = await getAssignmentStudents(assignment.classroom_id, assignment.subject);

    currentAssignmentState.assignmentId = assignment.id;
    currentAssignmentState.classroomId = assignment.classroom_id;
    currentAssignmentState.subject = assignment.subject;
    currentAssignmentState.students = students;
    currentAssignmentState.classroom = classroom;

    const sectionLabel = normalizeSection(classroom.section);
    document.getElementById("attendanceHeading").textContent = sectionLabel
      ? `Attendance Sheet - ${classroom.class_name} ${sectionLabel} (${assignment.subject})`
      : `Attendance Sheet - ${classroom.class_name} (${assignment.subject})`;

    const body = document.getElementById("studentAttendanceBody");
    if (!students.length) {
      body.innerHTML = `<tr><td colspan="6" class="empty">No eligible students for this class.</td></tr>`;
      setTeacherPanel("teacherAttendance");
      return;
    }

    body.innerHTML = students
      .map(
        (student, index) => `
          <tr>
            <td>${index + 1}</td>
            <td>${escapeHtml(student.name)}</td>
            <td>${escapeHtml(classroom.class_name)}</td>
            <td>${escapeHtml(sectionLabel || "-")}</td>
            <td>${escapeHtml(displayLanguage(student.language))}</td>
            <td>
              <button
                type="button"
                id="${getAttendanceButtonId(student.id)}"
                class="small attendance-toggle"
                data-status="present"
                aria-pressed="false"
                onclick="toggleAttendanceStatus('${student.id}')"
              >Present</button>
            </td>
          </tr>
        `
      )
      .join("");

    setTeacherPanel("teacherAttendance");
  } catch (error) {
    console.error("Failed to open attendance:", error);
    alert("Unable to open attendance sheet.");
  }
}

function collectAttendanceRows() {
  if (!currentAssignmentState.assignmentId) {
    alert("Open an assigned class first.");
    return null;
  }

  if (!currentAssignmentState.students.length) {
    alert("No students available for this class.");
    return null;
  }

  return currentAssignmentState.students.map((student) => {
    const statusButton = document.getElementById(getAttendanceButtonId(student.id));
    return {
      student_id: student.id,
      status: statusButton?.dataset.status === "absent" ? "absent" : "present"
    };
  });
}

async function submitAttendance() {
  const records = collectAttendanceRows();
  if (!records) {
    return;
  }

  const attendanceDate = getSelectedAttendanceDate();
  const attendanceTime = getSelectedAttendanceTime();
  const attendanceISO = getAttendanceTimestamp(attendanceDate, attendanceTime);
  const { data: existingSheets, error: existingSheetError } = await db
    .from("attendance")
    .select("id")
    .eq("assignment_id", currentAssignmentState.assignmentId)
    .eq("date", attendanceISO);

  if (existingSheetError) {
    console.error("Attendance sheet lookup failed:", existingSheetError);
    alert("Unable to verify attendance for this date.");
    return;
  }

  let attendanceId = existingSheets?.[0]?.id || null;
  const duplicateAttendanceIds = (existingSheets || []).slice(1).map((sheet) => sheet.id);
  if (attendanceId) {
    const replaceExisting = await showConfirmDialog("Attendance already exists for this class, subject, date, and time. Update the saved sheet with the current marks?", {
      title: "Update Attendance",
      confirmText: "Update"
    });

    if (!replaceExisting) {
      return;
    }
  }

  const absentNames = records
    .filter((record) => record.status === "absent")
    .map((record) => currentAssignmentState.students.find((student) => student.id === record.student_id)?.name || "Unknown");

  const absentList = document.getElementById("absentList");
  absentList.innerHTML = absentNames.length
    ? absentNames.map((name) => `<li>${escapeHtml(name)}</li>`).join("")
    : "<li>No absentees</li>";

  const modal = document.getElementById("confirmModal");
  modal.showModal();

  const confirmBtn = document.getElementById("confirmSubmit");
  const cancelBtn = document.getElementById("cancelConfirm");

  const confirmHandler = async () => {
    try {
      if (attendanceId) {
        const { error: deleteOldRecordsError } = await db
          .from("attendance_records")
          .delete()
          .eq("attendance_id", attendanceId);

        if (deleteOldRecordsError) {
          throw deleteOldRecordsError;
        }

        if (duplicateAttendanceIds.length) {
          const { error: deleteDuplicateRecordsError } = await db
            .from("attendance_records")
            .delete()
            .in("attendance_id", duplicateAttendanceIds);

          if (deleteDuplicateRecordsError) {
            throw deleteDuplicateRecordsError;
          }

          const { error: deleteDuplicateSheetsError } = await db
            .from("attendance")
            .delete()
            .in("id", duplicateAttendanceIds);

          if (deleteDuplicateSheetsError) {
            throw deleteDuplicateSheetsError;
          }
        }

        const { error: updateSheetError } = await db
          .from("attendance")
            .update({
              classroom_id: currentAssignmentState.classroomId,
            date: attendanceISO,
              subject: currentAssignmentState.subject
            })
          .eq("id", attendanceId);

        if (updateSheetError) {
          throw updateSheetError;
        }
      }

      if (!attendanceId) {
        const { data: attendance, error: attendanceError } = await db
          .from("attendance")
          .insert({
            assignment_id: currentAssignmentState.assignmentId,
            classroom_id: currentAssignmentState.classroomId,
            date: attendanceISO,
            subject: currentAssignmentState.subject
          })
          .select("id")
          .single();

        if (attendanceError) {
          throw attendanceError;
        }

        attendanceId = attendance.id;
      }

      const attendanceRecords = records.map((record) => ({
        attendance_id: attendanceId,
        student_id: record.student_id,
        status: record.status
      }));

      const { error: recordsError } = await db.from("attendance_records").insert(attendanceRecords);
      if (recordsError) {
        throw recordsError;
      }

      modal.close();
      alert("Attendance saved successfully.");
      if (document.getElementById("reportAssignmentSelect")?.value === currentAssignmentState.assignmentId) {
        await loadAttendanceReport();
      }
    } catch (error) {
      console.error("Attendance submit failed:", error);
      alert("Failed to save attendance.");
    } finally {
      confirmBtn.removeEventListener("click", confirmClickHandler);
      cancelBtn.removeEventListener("click", cancelHandler);
    }
  };

  const confirmClickHandler = () => {
    runLockedAction(`confirm-attendance-${currentAssignmentState.assignmentId}`, confirmHandler, confirmBtn);
  };

  const cancelHandler = () => {
    modal.close();
    confirmBtn.removeEventListener("click", confirmClickHandler);
    cancelBtn.removeEventListener("click", cancelHandler);
  };

  confirmBtn.dataset.busyText = "Saving...";
  confirmBtn.addEventListener("click", confirmClickHandler);
  cancelBtn.addEventListener("click", cancelHandler);
}

async function loadTeacherView() {
  teacherState.assignments = await getTeacherAssignments();
  teacherState.classroomMap = await getClassroomMap();
  await updateTeacherSummary();
  renderAssignedClasses();
  renderReportOptions();
}

function initTeacherPage() {
  if (!teacherSession) {
    return;
  }

  const teacherCode = teacherSession.teacherId ? ` (${normalizeText(teacherSession.teacherId)})` : "";
  document.getElementById("teacherTitle").textContent =
    `Teacher Panel - ${normalizeText(teacherSession.name)}${teacherCode}`;

  document.querySelectorAll(".nav-tab").forEach((tab) => {
    tab.addEventListener("click", () => setTeacherPanel(tab.dataset.panel));
  });

  const attendanceDate = document.getElementById("attendanceDate");
  if (attendanceDate) {
    attendanceDate.value = new Date().toISOString().slice(0, 10);
  }
  const attendanceTime = document.getElementById("attendanceTime");
  if (attendanceTime) {
    attendanceTime.value = "09:00";
  }

  const submitAttendanceBtn = document.getElementById("submitAttendanceBtn");
  const loadReportBtn = document.getElementById("loadReportBtn");
  const exportReportBtn = document.getElementById("exportReportBtn");

  submitAttendanceBtn.dataset.busyText = "Saving...";
  loadReportBtn.dataset.busyText = "Loading...";
  exportReportBtn.dataset.busyText = "Exporting...";

  submitAttendanceBtn.addEventListener("click", (event) => runLockedAction("submit-attendance", submitAttendance, event.currentTarget));
  loadReportBtn.addEventListener("click", (event) => {
    runLockedAction("teacher-load-report", loadAttendanceReport, event.currentTarget).catch((error) => {
      console.error("Attendance report failed:", error);
      alert("Unable to load attendance report.");
    });
  });
  exportReportBtn.addEventListener("click", (event) => runLockedAction("teacher-export-report", exportAttendanceReport, event.currentTarget));
  document.getElementById("logoutBtn").addEventListener("click", () => {
    signOutAndClearSession().finally(() => {
      window.location.href = "index.html";
    });
  });
}

window.openAttendance = openAttendance;
window.toggleAttendanceStatus = toggleAttendanceStatus;

async function bootstrapTeacherPage() {
  teacherSession = await ensureRoleSession("teacher");
  if (!teacherSession) {
    return;
  }

  initTeacherPage();

  try {
    await loadTeacherView();
  } catch (error) {
    console.error("Failed to load teacher view:", error);
    alert("Unable to load teacher dashboard.");
  }
}

bootstrapTeacherPage();
