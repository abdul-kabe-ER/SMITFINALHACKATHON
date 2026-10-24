"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { apiRequest } from "../../lib/api";

const navigation = {
  admin: [
    ["Overview","⌂"],["Employees","♙"],["Attendance","✓"],["Leave","▣"],["Payroll","＄"],
    ["Departments & Settings","⚙"],["Announcements","◉"],["AI Assistant","✦"],["Audit Log","≡"]
  ],
  hr: [
    ["Overview","⌂"],["Employees","♙"],["Attendance","✓"],["Leave","▣"],["Payroll","＄"],
    ["Departments & Settings","⚙"],["Announcements","◉"],["AI Assistant","✦"]
  ],
  employee: [
    ["Overview","⌂"],["My Profile","♙"],["Attendance","✓"],["Leave","▣"],["Payroll","＄"],
    ["Announcements","◉"],["AI Assistant","✦"]
  ]
};
const today = () => new Date().toISOString().slice(0,10);
const monthNow = () => new Date().toISOString().slice(0,7);
const money = value => new Intl.NumberFormat("en-PK", { style:"currency", currency:"PKR", maximumFractionDigits:0 }).format(Number(value || 0));
const dateText = value => value ? new Date(value).toLocaleDateString() : "—";
const roleLabel = role => ({ admin:"Admin", hr:"HR", employee:"Employee", teacher:"HR", student:"Employee" }[role] || role);

export default function DashboardPage() {
  const router = useRouter();
  const [user, setUser] = useState(null);
  const [activeNav, setActiveNav] = useState("Overview");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [summary, setSummary] = useState({});
  const [employees, setEmployees] = useState([]);
  const [departments, setDepartments] = useState([]);
  const [attendance, setAttendance] = useState([]);
  const [leaves, setLeaves] = useState([]);
  const [leaveBalance, setLeaveBalance] = useState(null);
  const [payroll, setPayroll] = useState([]);
  const [announcements, setAnnouncements] = useState([]);
  const [auditEvents, setAuditEvents] = useState([]);
  const [settings, setSettings] = useState(null);
  const [search, setSearch] = useState("");
  const [employeeForm, setEmployeeForm] = useState({ name:"", email:"", employeeCode:"", department:"", designation:"", salary:"", phone:"", address:"", dateOfJoining:today() });
  const [hrForm, setHrForm] = useState({ name:"", email:"", department:"" });
  const [departmentName, setDepartmentName] = useState("");
  const [leaveForm, setLeaveForm] = useState({ type:"casual", start:today(), end:today(), reason:"" });
  const [payrollMonth, setPayrollMonth] = useState(monthNow());
  const [announcementForm, setAnnouncementForm] = useState({ title:"", body:"", audience:"all" });
  const [chatMessage, setChatMessage] = useState("");
  const [chatHistory, setChatHistory] = useState([]);
  const [tempCredential, setTempCredential] = useState(null);
  const [passwordForm, setPasswordForm] = useState({ currentPassword:"", newPassword:"" });

  const token = () => typeof window !== "undefined" ? localStorage.getItem("authToken") : null;
  const api = useCallback((path, options = {}) => apiRequest(path, { ...options, token: token() }), []);

  const loadWorkspace = useCallback(async (currentUser) => {
    const role = currentUser?.role || "employee";
    const tasks = [
      api("/dashboard/summary").then(r=>setSummary(r.summary || {})),
      api("/announcements").then(r=>setAnnouncements(r.announcements || []))
    ];
    if (["admin","hr"].includes(role)) {
      tasks.push(api("/employees").then(r=>setEmployees(r.employees || [])));
      tasks.push(api("/departments").then(r=>setDepartments(r.departments || [])));
      tasks.push(api("/attendance").then(r=>setAttendance(r.attendance || [])));
      tasks.push(api("/leaves").then(r=>{setLeaves(r.leaves || []); setLeaveBalance(r.balance || null);}));
      tasks.push(api("/payroll").then(r=>setPayroll(r.payroll || [])));
      tasks.push(api("/settings").then(r=>setSettings(r.settings || null)));
      if (role === "admin") tasks.push(api("/audit").then(r=>setAuditEvents(r.events || [])).catch(()=>{}));
    } else {
      tasks.push(api("/employees").then(r=>setEmployees(r.employees || [])));
      tasks.push(api("/attendance").then(r=>setAttendance(r.attendance || [])));
      tasks.push(api("/leaves").then(r=>{setLeaves(r.leaves || []); setLeaveBalance(r.balance || null);}));
      tasks.push(api("/payroll").then(r=>setPayroll(r.payroll || [])));
    }
    await Promise.all(tasks);
  }, [api]);

  useEffect(() => {
    let active = true;
    async function start() {
      const saved = localStorage.getItem("authToken");
      if (!saved) { router.replace("/login"); return; }
      try {
        const me = await apiRequest("/auth/me", { token:saved });
        if (!active) return;
        const normalized = { ...me.user, role:me.user.role === "teacher" ? "hr" : me.user.role === "student" ? "employee" : me.user.role };
        setUser(normalized); localStorage.setItem("authUser", JSON.stringify(normalized));
        if (!normalized.mustChangePassword) await loadWorkspace(normalized);
      } catch (e) {
        if (active) { setError(e.message || "Unable to load your account."); localStorage.removeItem("authToken"); localStorage.removeItem("authUser"); router.replace("/login"); }
      } finally { if (active) setLoading(false); }
    }
    start(); return () => { active = false; };
  }, [router, loadWorkspace]);

  async function refresh() { if (!user) return; await loadWorkspace(user); }
  function logout() { localStorage.removeItem("authToken"); localStorage.removeItem("authUser"); router.replace("/login"); }
  async function act(fn, successMessage) {
    setBusy(true); setError(""); setNotice(""); setTempCredential(null);
    try { await fn(); await refresh(); if (successMessage) setNotice(successMessage); }
    catch (e) { setError(e.message || "Something went wrong."); }
    finally { setBusy(false); }
  }
  async function createEmployee(event) {
    event.preventDefault();
    await act(async()=>{const r=await api("/employees",{method:"POST",body:JSON.stringify(employeeForm)});setTempCredential({email:r.employee.email,password:r.temporaryPassword,label:"Employee login"});setEmployeeForm({name:"",email:"",employeeCode:"",department:"",designation:"",salary:"",phone:"",address:"",dateOfJoining:today()});},"Employee registered. Share the temporary password securely.");
  }
  async function createHr(event) {
    event.preventDefault();
    await act(async()=>{const r=await api("/users/hr",{method:"POST",body:JSON.stringify(hrForm)});setTempCredential({email:r.employee.email,password:r.temporaryPassword,label:"HR login"});setHrForm({name:"",email:"",department:""});},"HR account created.");
  }
  async function addDepartment(event) {
    event.preventDefault();
    await act(async()=>{await api("/departments",{method:"POST",body:JSON.stringify({name:departmentName})});setDepartmentName("");},"Department created.");
  }
  async function saveSettings(event) {
    event.preventDefault();
    await act(async()=>{const payload={...settings,graceMinutes:Number(settings.graceMinutes),halfDayHours:Number(settings.halfDayHours),officeRadius:Number(settings.officeRadius),officeLat:settings.officeLat===""?null:Number(settings.officeLat),officeLng:settings.officeLng===""?null:Number(settings.officeLng)};await api("/settings",{method:"PUT",body:JSON.stringify(payload)});},"Company settings saved.");
  }
  async function submitLeave(event) {
    event.preventDefault();
    await act(async()=>{await api("/leaves",{method:"POST",body:JSON.stringify(leaveForm)});setLeaveForm({type:"casual",start:today(),end:today(),reason:""});},"Leave request submitted.");
  }
  async function decideLeave(id, decision) {
    const comment = window.prompt(`Optional comment for ${decision}:`, "") || "";
    await act(async()=>{await api(`/leaves/${id}/decision`,{method:"PATCH",body:JSON.stringify({decision,comment})});},`Leave ${decision}.`);
  }
  async function runPayroll(event) {
    event.preventDefault();
    await act(async()=>{await api("/payroll/run",{method:"POST",body:JSON.stringify({month:payrollMonth})});},"Payroll draft generated.");
  }
  async function finalizePayroll(id) {
    if (!window.confirm("Finalize this payroll? A finalized month is locked.")) return;
    await act(async()=>{await api(`/payroll/${id}/finalize`,{method:"PATCH",body:JSON.stringify({})});},"Payroll finalized and locked.");
  }
  async function postAnnouncement(event) {
    event.preventDefault();
    await act(async()=>{await api("/announcements",{method:"POST",body:JSON.stringify(announcementForm)});setAnnouncementForm({title:"",body:"",audience:"all"});},"Announcement published.");
  }
  async function attendanceAction(action) {
    await act(async()=>{await api(`/attendance/${action}`,{method:"POST",body:JSON.stringify({})});},action==="check-in"?"Checked in successfully.":"Checked out successfully.");
  }
  async function sendChat(event) {
    event.preventDefault(); const question=chatMessage.trim(); if(!question)return;
    setChatHistory(h=>[...h,{role:"user",text:question}]); setChatMessage("");
    try { const r=await api("/ai/chat",{method:"POST",body:JSON.stringify({message:question})}); setChatHistory(h=>[...h,{role:"assistant",text:r.answer}]); }
    catch(e) { setChatHistory(h=>[...h,{role:"assistant",text:e.message || "Assistant is unavailable right now."}]); }
  }
  async function changePassword(event) {
    event.preventDefault();
    setBusy(true); setError(""); setNotice("");
    try {
      await api("/change-password",{method:"POST",body:JSON.stringify(passwordForm)});
      const updated = { ...user, mustChangePassword:false };
      setUser(updated); localStorage.setItem("authUser",JSON.stringify(updated));
      setPasswordForm({currentPassword:"",newPassword:""});
      await loadWorkspace(updated); setNotice("Password changed successfully.");
    } catch(e) { setError(e.message || "Unable to change password."); }
    finally { setBusy(false); }
  }

  if (loading) return <main className="dashboard-loading"><span className="loading-orb" />Loading your HCM Lite workspace…</main>;
  if (!user) return null;
  if (user.mustChangePassword) return <main className="force-password-page"><section className="panel force-password-card"><div className="brand"><span className="brand-mark">H</span> HCM Lite</div><p className="eyebrow">SECURITY REQUIRED</p><h1>Change your temporary password</h1><p className="muted">For your security, set a new password before entering the workspace.</p>{error&&<p className="message error" role="alert">{error}</p>}<form className="auth-form" onSubmit={changePassword}><label>Temporary password</label><input type="password" required value={passwordForm.currentPassword} onChange={e=>setPasswordForm({...passwordForm,currentPassword:e.target.value})}/><label>New password</label><input type="password" required minLength={8} maxLength={72} value={passwordForm.newPassword} onChange={e=>setPasswordForm({...passwordForm,newPassword:e.target.value})} placeholder="At least 8 characters"/><button className="primary-button" disabled={busy}>{busy?"Saving…":"Change password"}</button></form><button className="secondary-button" onClick={logout}>Log out</button></section></main>;
  const role = user.role || "employee";
  const nav = navigation[role] || navigation.employee;
  const isEmployee = role === "employee";
  const isHr = role === "hr";
  const isAdmin = role === "admin";
  const filteredEmployees = employees.filter(e => `${e.name} ${e.email} ${e.employeeCode} ${e.department}`.toLowerCase().includes(search.toLowerCase()));
  const todayRecord = isEmployee ? summary.today : attendance.find(a=>a.day===today());
  const currentPayroll = isEmployee ? payroll : payroll;

  return (
    <main className="workspace">
      <aside className="sidebar">
        <Link href="/dashboard" className="brand sidebar-brand"><span className="brand-mark">H</span> HCM Lite</Link>
        <p className="sidebar-label">WORKSPACE</p>
        <nav className="side-nav">{nav.map(([label,icon])=><button key={label} className={`side-link ${activeNav===label?"active":""}`} onClick={()=>{setActiveNav(label);setError("");setNotice("");}}><span className="side-icon">{icon}</span>{label}{label==="Leave"&&summary.pendingLeaves>0&&<span className="nav-count">{summary.pendingLeaves}</span>}</button>)}</nav>
        <div className="sidebar-bottom">
          <div className="sidebar-user"><div className="avatar small-avatar">{user.name?.charAt(0)?.toUpperCase()}</div><div className="sidebar-user-copy"><strong>{user.name}</strong><span>{roleLabel(role)}{user.department?` · ${user.department}`:""}</span></div></div>
          <button className="side-link logout-link" onClick={logout}><span className="side-icon">↪</span>Log out</button>
        </div>
      </aside>

      <section className="workspace-main">
        <header className="workspace-topbar"><div><span className="topbar-context">{summary.companyName || "HCM Lite"} /</span> <strong>{activeNav}</strong></div><div className="topbar-user"><span className="status-dot"/>{roleLabel(role)} workspace</div></header>
        <div className="workspace-content">
          <div className="page-heading"><div><p className="eyebrow">{isAdmin?"ADMINISTRATION":isHr?"PEOPLE OPERATIONS":"YOUR WORKSPACE"}</p><h1>{activeNav==="Overview"?`Good ${new Date().getHours()<12?"morning":new Date().getHours()<18?"afternoon":"evening"}, ${user.name.split(" ")[0]}`:activeNav}</h1><p className="muted">{isAdmin?"Company-wide controls, payroll finalization and audit visibility.":isHr?"Employee operations, attendance, leave approvals and payroll drafts.":"Your attendance, leave balance, payslips and company updates."}</p></div><div className="heading-avatar">{user.name?.charAt(0)?.toUpperCase()}</div></div>
          {error&&<p className="message error" role="alert">{error}</p>}
          {notice&&<p className="message success" role="status">{notice}</p>}
          {tempCredential&&<div className="credential-notice"><strong>{tempCredential.label} created</strong><span>Email: {tempCredential.email}</span><span>Temporary password: <code>{tempCredential.password}</code></span><small>Copy it now and share it privately. It will not be shown again.</small><button className="secondary-button" onClick={()=>navigator.clipboard?.writeText(`Email: ${tempCredential.email}\nTemporary password: ${tempCredential.password}`)}>Copy credentials</button></div>}

          {activeNav==="Overview"&&<section className="overview-page">
            {isEmployee ? <>
              <div className="stat-grid">
                <Stat icon="✓" color="green-icon" label="Attendance this month" value={`${summary.hoursThisMonth||0} h`} note="Tracked working hours"/>
                <Stat icon="◷" color="purple-icon" label="Late arrivals" value={summary.lateCount||0} note="This month"/>
                <Stat icon="▣" color="blue-icon" label="Casual leave left" value={summary.leaveBalance?.casual?.remaining??"—"} note="Days remaining"/>
              </div>
              <div className="panel attendance-hero"><div><p className="eyebrow">TODAY · {new Date().toLocaleDateString()}</p><h2>{todayRecord?.checkIn ? (todayRecord.checkOut?"Your workday is complete":"You’re checked in") : "Ready to start your day?"}</h2><p className="muted">{todayRecord?.checkIn?`Checked in at ${new Date(todayRecord.checkIn).toLocaleTimeString([], {hour:"2-digit",minute:"2-digit"})}${todayRecord.checkOut?` · checked out at ${new Date(todayRecord.checkOut).toLocaleTimeString([], {hour:"2-digit",minute:"2-digit"})}`:""}`:"Attendance timestamps are recorded by the server."}</p></div><div className="hero-actions">{!todayRecord?.checkIn?<button className="primary-button create-button" disabled={busy} onClick={()=>attendanceAction("check-in")}>✓ Check in</button>:!todayRecord?.checkOut?<button className="primary-button create-button" disabled={busy} onClick={()=>attendanceAction("check-out")}>↗ Check out</button>:<span className="status-pill status-approved">Completed</span>}</div></div>
              <div className="two-col-grid"><section className="panel"><SectionTitle title="Leave balance" subtitle="Your annual allowance and usage"/>{summary.leaveBalance&&Object.entries(summary.leaveBalance).map(([key,v])=><div className="balance-row" key={key}><div><strong>{pretty(key)}</strong><span>{v.used} used of {v.quota===999?"Unlimited":v.quota}</span></div><strong>{v.remaining===999?"Unlimited":v.remaining} left</strong></div>)}</section><section className="panel"><SectionTitle title="Last payslip" subtitle="Most recent finalized payroll"/>{summary.lastPayslip?<div className="payslip-highlight"><span>{summary.lastPayslip.employeeCode||"Monthly payroll"}</span><strong>{money(summary.lastPayslip.net)}</strong><small>Net pay · {payroll[0]?.month||"Latest"}</small></div>:<Empty text="Your finalized payslip will appear here."/>}</section></div>
            </>:<>
              <div className="stat-grid">
                <Stat icon="♙" color="blue-icon" label="Active employees" value={summary.headcount??0} note="Current headcount"/>
                <Stat icon="✓" color="green-icon" label="Present today" value={summary.present??0} note={`${summary.onLeave||0} currently on approved leave`}/>
                <Stat icon="◷" color="purple-icon" label="Late today" value={summary.late??0} note={`${summary.pendingLeaves||0} pending leave requests`}/>
              </div>
              <div className="two-col-grid">
                <section className="panel"><SectionTitle title="Attendance today" subtitle="Live snapshot from recorded check-ins"/><div className="mini-stat-row"><div><span>Present / recorded</span><strong>{summary.present||0}</strong></div><div><span>On leave</span><strong>{summary.onLeave||0}</strong></div><div><span>Late</span><strong>{summary.late||0}</strong></div></div>{summary.lateComers?.length>0?<><h4 className="subheading">Late arrivals</h4>{summary.lateComers.slice(0,5).map((x,i)=><div className="simple-row" key={`${x.name}-${i}`}><span className="row-avatar">{x.name?.charAt(0)}</span><div><strong>{x.name}</strong><small>{x.department||"Unassigned"}</small></div><span className="status-pill status-pending">Late</span></div>)}</>:<Empty text="No late arrivals recorded today."/>}</section>
                <section className="panel"><SectionTitle title="Headcount by department" subtitle="Based on employee records"/>{summary.byDepartment?.length?summary.byDepartment.map(d=><div className="department-bar" key={d._id}><div><span>{d._id||"Unassigned"}</span><strong>{d.count}</strong></div><div className="progress-track"><span style={{width:`${Math.min(100,((d.count||0)/Math.max(1,summary.headcount||0))*100)}%`}}/></div></div>):<Empty text="Register employees to see department analytics."/>}</section>
              </div>
              <section className="panel payroll-overview"><SectionTitle title="Payroll overview" subtitle="Recent monthly runs"/>{summary.payroll?.length?summary.payroll.map(p=><div className="simple-row" key={p.month}><div><strong>{p.month}</strong><small>{money(p.grossTotal)} gross</small></div><span className={`status-pill ${p.status==="finalized"?"status-approved":"status-pending"}`}>{p.status}</span><strong>{money(p.netTotal)}</strong></div>):<Empty text="No payroll runs yet. HR can create the first monthly draft."/>}</section>
            </>}
            <section className="panel announcements-panel"><SectionTitle title="Company announcements" subtitle="Latest updates for your team"/><AnnouncementList items={announcements.slice(0,4)}/></section>
          </section>}

          {(activeNav==="Employees"||activeNav==="My Profile")&&<section className="module-stack">
            {isEmployee?<section className="panel"><SectionTitle title="Your employee profile" subtitle="You can update your phone and address. Ask HR to change job details."/><div className="profile-grid"><ProfileField label="Full name" value={user.name}/><ProfileField label="Work email" value={user.email}/><ProfileField label="Employee code" value={user.employeeCode||"Not assigned"}/><ProfileField label="Department" value={user.department||"Not assigned"}/><ProfileField label="Designation" value={user.designation||"Not assigned"}/><ProfileField label="Employment status" value={pretty(user.status||"active")}/></div><form className="inline-form" onSubmit={e=>{e.preventDefault();act(async()=>{await api(`/employees/${user.id}`,{method:"PATCH",body:JSON.stringify({phone:e.currentTarget.phone.value,address:e.currentTarget.address.value})});},"Profile updated.");}}><label>Phone<input name="phone" defaultValue={user.phone||""} placeholder="+92…"/></label><label>Address<input name="address" defaultValue={user.address||""} placeholder="Home address"/></label><button className="primary-button create-button">Save profile</button></form></section>:<>
              {isHr&&<section className="panel"><SectionTitle title="Register employee" subtitle="Creates an employee login with a one-time temporary password."/><form className="form-grid" onSubmit={createEmployee}><Field label="Full name"><input required minLength={2} value={employeeForm.name} onChange={e=>setEmployeeForm({...employeeForm,name:e.target.value})}/></Field><Field label="Work email"><input required type="email" value={employeeForm.email} onChange={e=>setEmployeeForm({...employeeForm,email:e.target.value})}/></Field><Field label="Employee code (optional)"><input value={employeeForm.employeeCode} onChange={e=>setEmployeeForm({...employeeForm,employeeCode:e.target.value})} placeholder="EMP-001"/></Field><Field label="Department"><select value={employeeForm.department} onChange={e=>setEmployeeForm({...employeeForm,department:e.target.value})}><option value="">Select department</option>{departments.map(d=><option key={d._id} value={d.name}>{d.name}</option>)}</select></Field><Field label="Designation"><input required value={employeeForm.designation} onChange={e=>setEmployeeForm({...employeeForm,designation:e.target.value})} placeholder="e.g. Software Engineer"/></Field><Field label="Monthly salary (PKR)"><input type="number" min="1" required value={employeeForm.salary} onChange={e=>setEmployeeForm({...employeeForm,salary:e.target.value})}/></Field><Field label="Joining date"><input type="date" value={employeeForm.dateOfJoining} onChange={e=>setEmployeeForm({...employeeForm,dateOfJoining:e.target.value})}/></Field><Field label="Phone"><input value={employeeForm.phone} onChange={e=>setEmployeeForm({...employeeForm,phone:e.target.value})}/></Field><Field label="Address"><input value={employeeForm.address} onChange={e=>setEmployeeForm({...employeeForm,address:e.target.value})}/></Field><div className="form-actions"><button className="primary-button create-button" disabled={busy}>Register employee</button></div></form></section>}
              {isAdmin&&<section className="panel"><SectionTitle title="Create HR login" subtitle="Only Admin can provision HR accounts."/><form className="inline-form" onSubmit={createHr}><label>Full name<input required value={hrForm.name} onChange={e=>setHrForm({...hrForm,name:e.target.value})}/></label><label>Work email<input type="email" required value={hrForm.email} onChange={e=>setHrForm({...hrForm,email:e.target.value})}/></label><label>Department<input value={hrForm.department} onChange={e=>setHrForm({...hrForm,department:e.target.value})}/></label><button className="primary-button create-button" disabled={busy}>Create HR login</button></form></section>}
              <section className="panel"><SectionTitle title="Employee directory" subtitle={`${employees.length} records available in your scope`}/><div className="toolbar"><input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search name, email, code or department…"/><button className="secondary-button" onClick={()=>refresh()}>Refresh</button></div><div className="table-wrap"><table><thead><tr><th>Employee</th><th>Code</th><th>Department</th><th>Designation</th><th>Status</th><th>Salary</th></tr></thead><tbody>{filteredEmployees.map(e=><tr key={e.id}><td><strong>{e.name}</strong><small>{e.email}</small></td><td>{e.employeeCode||"—"}</td><td>{e.department||"—"}</td><td>{e.designation||"—"}</td><td><span className={`status-pill ${e.status==="active"?"status-approved":"status-pending"}`}>{pretty(e.status||"active")}</span></td><td>{isAdmin||isHr?money(e.salary):"Private"}</td></tr>)}</tbody></table>{filteredEmployees.length===0&&<Empty text="No employees match this search."/>}</div></section>
            </>}
          </section>}

          
{activeNav==="Attendance"&&<section className="module-stack">
  {isEmployee&&(
    <>
      <section className="panel attendance-hero">
        <div>
          <p className="eyebrow">TODAY · {today()}</p>
          <h2>
            {todayRecord?.checkIn
              ? todayRecord.checkOut
                ? "Attendance complete"
                : "You are checked in"
              : "Record your attendance"}
          </h2>
          <p className="muted">
            Use the camera check-in page to verify your face and
            office location before recording attendance.
          </p>
        </div>

        <div className="hero-actions">
          <Link
            href="/attendance"
            className="primary-button create-button"
          >
            Open Camera Check-in →
          </Link>
        </div>
      </section>

      <section className="panel">
        <SectionTitle
          title="Quick attendance"
          subtitle="Your attendance status for today"
        />

        <div className="profile-grid">
          <ProfileField
            label="Status"
            value={
              todayRecord?.checkOut
                ? "Completed"
                : todayRecord?.checkIn
                  ? "Checked in"
                  : "Not checked in"
            }
          />

          <ProfileField
            label="Check-in"
            value={
              todayRecord?.checkIn
                ? new Date(todayRecord.checkIn).toLocaleTimeString(
                    [],
                    { hour: "2-digit", minute: "2-digit" }
                  )
                : "Not recorded"
            }
          />

          <ProfileField
            label="Check-out"
            value={
              todayRecord?.checkOut
                ? new Date(todayRecord.checkOut).toLocaleTimeString(
                    [],
                    { hour: "2-digit", minute: "2-digit" }
                  )
                : "Not recorded"
            }
          />
        </div>
      </section>
    </>
  )}

  <section className="panel">
    <SectionTitle
      title={isEmployee ? "My attendance history" : "Daily attendance board"}
      subtitle={
        isEmployee
          ? "Your recorded check-in and check-out times."
          : "Attendance records created by employees."
      }
    />

    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Employee</th>
            <th>Date</th>
            <th>Check in</th>
            <th>Check out</th>
            <th>Status</th>
            <th>Source</th>
          </tr>
        </thead>

        <tbody>
          {attendance.map(a=>(
            <tr key={a._id}>
              <td>
                <strong>{a.employee?.name||user.name}</strong>
                <small>
                  {a.employee?.department||user.department||""}
                </small>
              </td>
              <td>{a.day}</td>
              <td>
                {a.checkIn
                  ? new Date(a.checkIn).toLocaleTimeString(
                      [],
                      {hour:"2-digit",minute:"2-digit"}
                    )
                  : "—"}
              </td>
              <td>
                {a.checkOut
                  ? new Date(a.checkOut).toLocaleTimeString(
                      [],
                      {hour:"2-digit",minute:"2-digit"}
                    )
                  : "—"}
              </td>
              <td>
                <span className={`status-pill ${
                  ["present","approved"].includes(a.status)
                    ? "status-approved"
                    : a.status==="late"
                      ? "status-pending"
                      : "status-neutral"
                }`}>
                  {pretty(a.status)}
                </span>
              </td>
              <td>{a.source||"web"}</td>
            </tr>
          ))}
        </tbody>
      </table>

      {attendance.length===0&&(
        <Empty text="No attendance records yet."/>
      )}
    </div>
  </section>
</section>}


          {activeNav==="Leave"&&<section className="module-stack">
            {isEmployee&&<section className="panel"><SectionTitle title="Request leave" subtitle="Only working days count. Overlapping dates and requests over your balance are rejected."/><form className="form-grid" onSubmit={submitLeave}><Field label="Leave type"><select value={leaveForm.type} onChange={e=>setLeaveForm({...leaveForm,type:e.target.value})}><option value="casual">Casual leave</option><option value="sick">Sick leave</option><option value="annual">Annual leave</option><option value="unpaid">Unpaid leave</option></select></Field><Field label="Start date"><input type="date" required min={today()} value={leaveForm.start} onChange={e=>setLeaveForm({...leaveForm,start:e.target.value})}/></Field><Field label="End date"><input type="date" required min={leaveForm.start} value={leaveForm.end} onChange={e=>setLeaveForm({...leaveForm,end:e.target.value})}/></Field><Field label="Reason"><input required maxLength={1000} value={leaveForm.reason} onChange={e=>setLeaveForm({...leaveForm,reason:e.target.value})} placeholder="Briefly explain your request"/></Field><div className="form-actions"><button className="primary-button create-button" disabled={busy}>Submit request</button></div></form>{leaveBalance&&<div className="balance-grid">{Object.entries(leaveBalance).map(([k,v])=><div className="balance-tile" key={k}><span>{pretty(k)}</span><strong>{v.remaining===999?"∞":v.remaining}</strong><small>{v.used} used · {v.quota===999?"Unlimited":`${v.quota} annual quota`}</small></div>)}</div>}</section>}
            <section className="panel"><SectionTitle title={isEmployee?"My leave history":"Leave approval inbox"} subtitle={isEmployee?"Track request status and decisions.":"Review pending requests and add a decision comment."}/><div className="table-wrap"><table><thead><tr><th>Employee</th><th>Type</th><th>Dates</th><th>Days</th><th>Reason</th><th>Status</th>{isHr&&<th>Action</th>}</tr></thead><tbody>{leaves.map(l=><tr key={l._id}><td><strong>{l.employee?.name||user.name}</strong><small>{l.employee?.department||""}</small></td><td>{pretty(l.type)}</td><td>{l.start} → {l.end}</td><td>{l.days}</td><td className="reason-cell">{l.reason}</td><td><span className={`status-pill ${l.status==="approved"?"status-approved":l.status==="pending"?"status-pending":"status-neutral"}`}>{pretty(l.status)}</span>{l.decisionComment&&<small>{l.decisionComment}</small>}</td>{isHr&&<td>{l.status==="pending"?<div className="row-actions"><button className="small-action approve-action" onClick={()=>decideLeave(l._id,"approved")}>Approve</button><button className="small-action reject-action" onClick={()=>decideLeave(l._id,"rejected")}>Reject</button></div>:"—"}</td>}</tr>)}</tbody></table>{leaves.length===0&&<Empty text="No leave requests have been submitted."/>}</div></section>
          </section>}

          {activeNav==="Payroll"&&<section className="module-stack">
            {isHr&&<section className="panel"><SectionTitle title="Run monthly payroll" subtitle="Creates a draft from employee salary, attendance and approved unpaid leave."/><form className="inline-form" onSubmit={runPayroll}><label>Payroll month<input type="month" value={payrollMonth} onChange={e=>setPayrollMonth(e.target.value)} required/></label><button className="primary-button create-button" disabled={busy}>Generate draft</button></form><p className="microcopy">Draft formula: gross salary less absence / unpaid leave / half-day deductions and illustrative tax. Admin finalizes and locks the month.</p></section>}
            <section className="panel"><SectionTitle title={isEmployee?"My payslips":"Monthly payroll runs"} subtitle={isEmployee?"Only your own finalized payslips are visible.":"Review draft totals and finalize a month as Admin."}/>{!isEmployee&&<div className="stat-grid compact-stats"><Stat icon="＄" color="blue-icon" label="Payroll runs" value={payroll.length}/><Stat icon="▤" color="green-icon" label="Finalized" value={payroll.filter(p=>p.status==="finalized").length}/><Stat icon="◷" color="purple-icon" label="Drafts" value={payroll.filter(p=>p.status==="draft").length}/></div>}<div className="table-wrap"><table><thead><tr><th>Month</th>{!isEmployee&&<><th>Employees</th><th>Gross total</th></>}<th>Net pay</th><th>Status</th>{isAdmin&&<th>Action</th>}</tr></thead><tbody>{currentPayroll.map(p=>{const own=p.payslip||null;return <tr key={p._id||p.month}><td><strong>{p.month}</strong></td>{!isEmployee&&<><td>{p.rows?.length||0}</td><td>{money(p.grossTotal)}</td></>}<td>{money(isEmployee?own?.net:p.netTotal)}</td><td><span className={`status-pill ${p.status==="finalized"?"status-approved":"status-pending"}`}>{pretty(p.status)}</span></td>{isAdmin&&<td>{p.status==="draft"?<button className="small-action approve-action" onClick={()=>finalizePayroll(p._id)}>Finalize & lock</button>:"Locked"}</td>}</tr>;})}</tbody></table>{payroll.length===0&&<Empty text="No payroll has been generated yet."/>}</div>{isEmployee&&payroll.map(p=>p.payslip&&<div className="payslip-card" key={p.month}><div><span>{p.month} payslip</span><strong>{money(p.payslip.net)}</strong><small>Net pay · Gross {money(p.payslip.gross)}</small></div><div className="payslip-lines"><span>Basic <b>{money(p.payslip.basic)}</b></span><span>HRA <b>{money(p.payslip.hra)}</b></span><span>Medical <b>{money(p.payslip.medical)}</b></span><span>Deductions <b>{money(p.payslip.deduction)}</b></span><span>Tax <b>{money(p.payslip.tax)}</b></span></div></div>)}</section>
          </section>}

          {activeNav==="Departments & Settings"&&<section className="module-stack">
            <section className="panel"><SectionTitle title="Departments" subtitle="Admin manages the organization structure; HR can use departments when registering employees."/><form className="inline-form" onSubmit={addDepartment}><label>New department name<input required minLength={2} value={departmentName} onChange={e=>setDepartmentName(e.target.value)} placeholder="e.g. Engineering"/></label><button className="primary-button create-button" disabled={!isAdmin||busy}>{isAdmin?"Add department":"Admin access required"}</button></form><div className="department-list">{departments.map(d=><div className="department-chip" key={d._id}><span className="department-dot"/><strong>{d.name}</strong></div>)}{departments.length===0&&<Empty text="No departments have been created yet."/>}</div></section>
            {settings&&<section className="panel"><SectionTitle title="Company settings" subtitle={isAdmin?"Configure attendance rules, location and leave quotas.":"View current company rules."}/>{isAdmin?<form className="form-grid" onSubmit={saveSettings}><Field label="Company name"><input value={settings.companyName||""} onChange={e=>setSettings({...settings,companyName:e.target.value})}/></Field><Field label="Office start time"><input type="time" value={settings.officeStart||"09:00"} onChange={e=>setSettings({...settings,officeStart:e.target.value})}/></Field><Field label="Grace period (minutes)"><input type="number" min="0" max="180" value={settings.graceMinutes??15} onChange={e=>setSettings({...settings,graceMinutes:e.target.value})}/></Field><Field label="Half day under (hours)"><input type="number" min="1" max="12" value={settings.halfDayHours??5} onChange={e=>setSettings({...settings,halfDayHours:e.target.value})}/></Field><Field label="Office latitude"><input type="number" step="any" value={settings.officeLat??""} onChange={e=>setSettings({...settings,officeLat:e.target.value})} placeholder="Optional"/></Field><Field label="Office longitude"><input type="number" step="any" value={settings.officeLng??""} onChange={e=>setSettings({...settings,officeLng:e.target.value})} placeholder="Optional"/></Field><Field label="Office radius (meters)"><input type="number" min="1" value={settings.officeRadius??150} onChange={e=>setSettings({...settings,officeRadius:e.target.value})}/></Field><Field label="Weekend days (0=Sun, 6=Sat)"><input value={(settings.weekendDays||[0,6]).join(",")} onChange={e=>setSettings({...settings,weekendDays:e.target.value.split(",").map(Number).filter(n=>n>=0&&n<=6)})}/></Field><Field label="Public holidays (comma-separated dates)"><input value={(settings.holidays||[]).join(",")} onChange={e=>setSettings({...settings,holidays:e.target.value.split(",").map(v=>v.trim()).filter(v=>/^\d{4}-\d{2}-\d{2}$/.test(v))})} placeholder="2026-12-25, 2027-01-01"/></Field><Field label="Annual leave quota"><input type="number" value={settings.leaveQuotas?.annual??14} onChange={e=>setSettings({...settings,leaveQuotas:{...settings.leaveQuotas,annual:Number(e.target.value)}})}/></Field><Field label="Sick leave quota"><input type="number" value={settings.leaveQuotas?.sick??8} onChange={e=>setSettings({...settings,leaveQuotas:{...settings.leaveQuotas,sick:Number(e.target.value)}})}/></Field><Field label="Casual leave quota"><input type="number" value={settings.leaveQuotas?.casual??10} onChange={e=>setSettings({...settings,leaveQuotas:{...settings.leaveQuotas,casual:Number(e.target.value)}})}/></Field><div className="form-actions"><button className="primary-button create-button" disabled={busy}>Save settings</button></div></form>:<div className="profile-grid"><ProfileField label="Company" value={settings.companyName}/><ProfileField label="Office starts" value={settings.officeStart}/><ProfileField label="Grace period" value={`${settings.graceMinutes} minutes`}/><ProfileField label="Half day threshold" value={`${settings.halfDayHours} hours`}/><ProfileField label="Office radius" value={`${settings.officeRadius} m`}/></div>}</section>}
          </section>}

          {activeNav==="Announcements"&&<section className="module-stack">
            {(isAdmin||isHr)&&<section className="panel"><SectionTitle title="Publish announcement" subtitle="Announcements appear on the relevant employee dashboards."/><form className="form-grid" onSubmit={postAnnouncement}><Field label="Title"><input required maxLength={160} value={announcementForm.title} onChange={e=>setAnnouncementForm({...announcementForm,title:e.target.value})}/></Field><Field label="Audience"><select value={announcementForm.audience} onChange={e=>setAnnouncementForm({...announcementForm,audience:e.target.value})}><option value="all">Everyone</option><option value="hr">HR only</option><option value="employee">Employees</option></select></Field><Field label="Message"><textarea required maxLength={3000} rows={3} value={announcementForm.body} onChange={e=>setAnnouncementForm({...announcementForm,body:e.target.value})}/></Field><div className="form-actions"><button className="primary-button create-button" disabled={busy}>Publish</button></div></form></section>}
            <section className="panel"><SectionTitle title="Company updates" subtitle="Recent announcements for your role"/><AnnouncementList items={announcements}/></section>
          </section>}

          {activeNav==="AI Assistant"&&<section className="panel assistant-panel"><div className="assistant-heading"><div className="assistant-avatar">✦</div><div><SectionTitle title="HCM AI assistant" subtitle="Ask about attendance, leave and company policy. Answers are AI-generated and should be checked for important decisions."/></div><span className="ai-label">AI-GENERATED</span></div><div className="chat-suggestions"><button onClick={()=>setChatMessage("What is the company leave policy?")}>Leave policy</button><button onClick={()=>setChatMessage("How is lateness calculated?")}>Attendance rules</button><button onClick={()=>setChatMessage("How does monthly payroll work?")}>Payroll basics</button>{isEmployee&&<button onClick={()=>setChatMessage("How many sick leaves do I have left?")}>My sick leave</button>}</div><div className="chat-history">{chatHistory.length===0&&<div className="chat-welcome"><span>✦</span><strong>How can I help you today?</strong><p>I can explain company leave, attendance and payroll policies. I won’t disclose another employee’s private salary details.</p></div>}{chatHistory.map((m,i)=><div key={i} className={`chat-message ${m.role==="user"?"chat-user":"chat-assistant"}`}><span>{m.role==="user"?"You":"HCM AI · AI-generated"}</span><p>{m.text}</p></div>)}</div><form className="chat-form" onSubmit={sendChat}><input value={chatMessage} onChange={e=>setChatMessage(e.target.value)} placeholder="Ask a question about HR policy…" maxLength={1500}/><button className="primary-button create-button">Send ↑</button></form><p className="microcopy">For live LLM answers, configure AI_API_KEY on the backend only. Without it, a policy fallback remains available.</p></section>}

          {activeNav==="Audit Log"&&isAdmin&&<section className="panel"><SectionTitle title="Audit trail" subtitle="Recent changes to employees, leave, payroll and organization settings."/><div className="table-wrap"><table><thead><tr><th>When</th><th>Actor</th><th>Action</th><th>Entity</th><th>Details</th></tr></thead><tbody>{auditEvents.map(e=><tr key={e._id}><td>{new Date(e.createdAt).toLocaleString()}</td><td>{e.actor?.name||"System"}<small>{e.actor?.email||""}</small></td><td><code>{e.action}</code></td><td>{e.entity}</td><td>{e.after?JSON.stringify(e.after):"—"}</td></tr>)}</tbody></table>{auditEvents.length===0&&<Empty text="No audit events have been recorded yet."/>}</div></section>}

          <section className="panel password-panel"><SectionTitle title="Security" subtitle={user.mustChangePassword?"Please change your temporary password now.":"Update your account password."}/><form className="inline-form" onSubmit={changePassword}><label>Current password<input type="password" required value={passwordForm.currentPassword} onChange={e=>setPasswordForm({...passwordForm,currentPassword:e.target.value})}/></label><label>New password<input type="password" minLength={8} maxLength={72} required value={passwordForm.newPassword} onChange={e=>setPasswordForm({...passwordForm,newPassword:e.target.value})} placeholder="At least 8 characters"/></label><button className="secondary-button" disabled={busy}>Change password</button></form></section>
          <footer className="workspace-footer">HCM Lite <span>People operations, made clearer.</span></footer>
        </div>
      </section>
    </main>
  );
}

function Stat({icon,color,label,value,note}) { return <div className="stat-card"><span className={`stat-icon ${color}`}>{icon}</span><div><p>{label}</p><strong>{value}</strong><small>{note}</small></div></div>; }
function SectionTitle({title,subtitle}) { return <div className="section-heading"><div><h2>{title}</h2>{subtitle&&<p className="muted">{subtitle}</p>}</div></div>; }
function Field({label,children}) { return <label className="form-field"><span>{label}</span>{children}</label>; }
function ProfileField({label,value}) { return <div className="profile-field"><span>{label}</span><strong>{value||"—"}</strong></div>; }
function Empty({text}) { return <div className="empty-state compact-empty"><div className="empty-icon">◌</div><p>{text}</p></div>; }
function AnnouncementList({items}) { return items?.length?<div className="announcement-list">{items.map(a=><article className="announcement-item" key={a._id}><span className="announcement-mark">◉</span><div><h3>{a.title}</h3><p>{a.body}</p><small>{a.author?.name?`Posted by ${a.author.name} · `:""}{dateText(a.createdAt)}</small></div></article>)}</div>:<Empty text="No announcements yet."/>; }
function pretty(value) { return String(value||"").replaceAll("_"," ").replace(/\b\w/g,c=>c.toUpperCase()); }
