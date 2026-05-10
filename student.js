let studentSession = null;

function percent(attended, held) {
  if (!held) {
    return 0;
  }
  return (attended / held) * 100;
}

function classesNeededFor75(attended, held) {
  if (!held || attended / held >= 0.75) {
    return 0;
  }

  let extra = 0;
  while ((attended + extra) / (held + extra) < 0.75) {
    extra += 1;
  }
  return extra;
}

async function getStudent() {
  if (!studentSession) {
    alert("Student session expired. Please login again.");
    await signOutAndClearSession();
    window.location.href = "index.html";
    return null;
  }

  let response = await db
    .from("students")
    .select("*")
    .eq("id", studentSession.studentRecordId || studentSession.id)
    .maybeSingle();

  if (!response.error && !response.data && studentSession.email) {
    response = await db
      .from("students")
      .select("*")
      .eq("email", studentSession.email)
      .maybeSingle();
  }

  const { data, error } = response;

  if (error) {
    console.error("Student fetch failed:", error);
    alert("Unable to load student profile.");
    return null;
  }

  if (!data) {
    alert("Student record not found.");
    await signOutAndClearSession();
    window.location.href = "index.html";
    return null;
  }

  return data;
}

async function getSubjectRows(student) {
  const [assignmentsResponse, attendanceRecordsResponse] = await Promise.all([
    db.from("assignments").select("subject").eq("classroom_id", student.classroom_id),
    db.from("attendance_records").select("*").eq("student_id", student.id)
  ]);

  if (assignmentsResponse.error) {
    throw assignmentsResponse.error;
  }

  if (attendanceRecordsResponse.error) {
    throw attendanceRecordsResponse.error;
  }

  const assignments = assignmentsResponse.data || [];
  const attendanceRecords = attendanceRecordsResponse.data || [];
  const attendanceIds = [...new Set(attendanceRecords.map((record) => record.attendance_id).filter(Boolean))];

  let attendanceMap = new Map();
  if (attendanceIds.length) {
    const { data: attendanceRows, error: attendanceError } = await db
      .from("attendance")
      .select("*")
      .in("id", attendanceIds);

    if (attendanceError) {
      throw attendanceError;
    }

    attendanceMap = new Map((attendanceRows || []).map((row) => [row.id, row]));
  }

  const bySubject = {};

  assignments.forEach((assignment) => {
    if (!bySubject[assignment.subject]) {
      bySubject[assignment.subject] = { held: 0, attended: 0, rows: [] };
    }
  });

  attendanceRecords.forEach((record) => {
    const attendance = attendanceMap.get(record.attendance_id);
    if (!attendance) {
      return;
    }

    const subject = attendance.subject;
    if (!bySubject[subject]) {
      bySubject[subject] = { held: 0, attended: 0, rows: [] };
    }

    bySubject[subject].held += 1;
    if (record.status === "present") {
      bySubject[subject].attended += 1;
    }

    bySubject[subject].rows.push({
      dateISO: attendance.date,
      status: record.status,
      subject
    });
  });

  return bySubject;
}

async function buildSubjectSummary() {
  const student = await getStudent();
  if (!student) {
    return;
  }

  const bySubject = await getSubjectRows(student);
  const summaryBody = document.getElementById("subjectSummaryBody");
  const subjects = Object.keys(bySubject);

  if (!subjects.length) {
    summaryBody.innerHTML = `<tr><td colspan="7" class="empty">No attendance records found yet.</td></tr>`;
    return;
  }

  window.cachedSubjects = bySubject;

  summaryBody.innerHTML = subjects
    .map((subject, index) => {
      const data = bySubject[subject];
      const current = percent(data.attended, data.held);
      const absent = Math.max(data.held - data.attended, 0);

      return `
        <tr class="subject-list-row" onclick="showDetails('${subject.replace(/'/g, "\\'")}')">
          <td>${index + 1}</td>
          <td><strong>${escapeHtml(subject)}</strong></td>
          <td>${data.held}</td>
          <td>${data.attended}</td>
          <td>${absent}</td>
          <td>${current.toFixed(2)}%</td>
          <td><button class="small primary" type="button">View</button></td>
        </tr>
      `;
    })
    .join("");
}

function formatAttendanceDateTime(value) {
  if (!value) {
    return "-";
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return escapeHtml(String(value));
  }

  return parsed.toLocaleString();
}

function showDetails(subject) {
  const rows = window.cachedSubjects?.[subject]?.rows || [];
  const detailBody = document.getElementById("subjectDetailBody");
  const detailTitle = document.getElementById("detailTitle");
  const detailSummary = document.getElementById("detailSummary");
  const detailData = window.cachedSubjects?.[subject];
  const modal = document.getElementById("subjectDetailModal");

  detailTitle.textContent = `Subject Details - ${subject}`;
  if (detailData) {
    const attendancePercent = percent(detailData.attended, detailData.held);
    detailSummary.textContent = `${detailData.attended} attended out of ${detailData.held} classes. Current attendance is ${attendancePercent.toFixed(2)}%.`;
  } else {
    detailSummary.textContent = "";
  }

  if (!rows.length) {
    detailBody.innerHTML = `<tr><td colspan="3" class="empty">No records for this subject.</td></tr>`;
    if (!modal.open) {
      modal.showModal();
    }
    return;
  }

  const sortedRows = [...rows].sort((a, b) => new Date(b.dateISO) - new Date(a.dateISO));

  detailBody.innerHTML = sortedRows
    .map(
      (row, index) => `
      <tr>
        <td>${index + 1}</td>
        <td>${formatAttendanceDateTime(row.dateISO)}</td>
        <td>${escapeHtml(row.status)}</td>
      </tr>
    `
    )
    .join("");

  if (!modal.open) {
    modal.showModal();
  }
}

async function initStudentPage() {
  const student = await getStudent();
  if (!student) {
    return;
  }

  if (!student.access_requested) {
    alert("Submit access request first.");
    await signOutAndClearSession();
    window.location.href = "index.html";
    return;
  }

  if (!student.access_granted) {
    alert("Access not yet granted.");
    await signOutAndClearSession();
    window.location.href = "index.html";
    return;
  }

  document.getElementById("studentTitle").textContent = `Student Attendance - ${student.name}`;
  document.getElementById("logoutBtn").addEventListener("click", () => {
    signOutAndClearSession().finally(() => {
      window.location.href = "index.html";
    });
  });

  const subjectModal = document.getElementById("subjectDetailModal");
  const closeSubjectModal = document.getElementById("closeSubjectModal");
  closeSubjectModal.addEventListener("click", () => subjectModal.close());
  subjectModal.addEventListener("click", (event) => {
    if (event.target === subjectModal) {
      subjectModal.close();
    }
  });

  try {
    await buildSubjectSummary();
  } catch (error) {
    console.error("Student summary failed:", error);
    alert("Unable to load attendance summary.");
  }
}

window.showDetails = showDetails;

async function bootstrapStudentPage() {
  studentSession = await ensureRoleSession("student");
  if (!studentSession) {
    return;
  }

  initStudentPage();
}

bootstrapStudentPage();
