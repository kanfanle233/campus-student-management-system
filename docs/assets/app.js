(() => {
  'use strict';

  /*
   * Pages 版本只保留一个浏览器端数据适配器。
   * 六个业务字段与本地 Flask 版本保持一致：student_id、name、gender、age、class_name、phone。
   */
  const STORAGE_KEY = 'campusflow.students.v1';
  const PAGE_SIZE = 8;
  const VALID_GENDERS = ['男', '女', '其他'];
  const FIELD_ORDER = ['student_id', 'name', 'gender', 'age', 'class_name', 'phone'];
  const FIELD_LABELS = {
    student_id: '学号',
    name: '姓名',
    gender: '性别',
    age: '年龄',
    class_name: '班级',
    phone: '联系电话'
  };

  const SEED_STUDENTS = [
    { student_id: '20240108', name: '周子涵', gender: '女', age: 16, class_name: '高一（2）班', phone: '138-0000-1008' },
    { student_id: '20240107', name: '陈思远', gender: '男', age: 16, class_name: '高一（1）班', phone: '138-0000-1007' },
    { student_id: '20240106', name: '林语晴', gender: '女', age: 15, class_name: '高一（3）班', phone: '138-0000-1006' },
    { student_id: '20240105', name: '吴昊然', gender: '男', age: 16, class_name: '高一（4）班', phone: '138-0000-1005' },
    { student_id: '20240104', name: '赵若彤', gender: '女', age: 15, class_name: '高一（2）班', phone: '138-0000-1004' },
    { student_id: '20240103', name: '黄景行', gender: '男', age: 16, class_name: '高一（1）班', phone: '138-0000-1003' },
    { student_id: '20240102', name: '刘星宇', gender: '其他', age: 15, class_name: '高一（3）班', phone: '138-0000-1002' },
    { student_id: '20240101', name: '李安然', gender: '女', age: 16, class_name: '高一（4）班', phone: '138-0000-1001' }
  ];

  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));
  const cloneSeed = () => SEED_STUDENTS.map((student) => ({ ...student }));

  const els = {
    sidebar: $('#sidebar'),
    mobileMenu: $('#mobile-menu'),
    mobileBackdrop: $('#mobile-backdrop'),
    pageHeading: $('#page-heading'),
    currentSection: $('#current-section'),
    heroDate: $('#hero-date'),
    lastUpdated: $('#last-updated'),
    navCount: $('#nav-student-count'),
    modalBackdrop: $('#modal-backdrop'),
    studentModal: $('#student-modal'),
    detailModal: $('#detail-modal'),
    studentForm: $('#student-form'),
    modalTitle: $('#modal-title'),
    editingId: $('#editing-id'),
    modalSubmit: $('#modal-submit'),
    detailTitle: $('#detail-title'),
    detailContent: $('#detail-content'),
    detailEdit: $('#detail-edit'),
    search: $('#student-search'),
    classFilter: $('#class-filter'),
    genderFilter: $('#gender-filter'),
    selectAll: $('#select-all'),
    tbody: $('#student-tbody'),
    tableEmpty: $('#table-empty'),
    tableSummary: $('#table-summary'),
    pagination: $('#pagination'),
    classChart: $('#class-chart'),
    recentList: $('#recent-list'),
    csvInput: $('#csv-input'),
    toastRegion: $('#toast-region')
  };

  let memoryData = cloneSeed();
  let students = readStudents();
  let currentView = 'dashboard';
  let currentPage = 1;
  let editingStudentId = '';
  let detailStudentId = '';
  let toastTimer = 0;
  const selectedIds = new Set();

  function safeStorageGet() {
    try {
      return window.localStorage.getItem(STORAGE_KEY);
    } catch (_error) {
      return null;
    }
  }

  function safeStorageSet(value) {
    try {
      window.localStorage.setItem(STORAGE_KEY, value);
      return true;
    } catch (_error) {
      return false;
    }
  }

  function normalizeStudent(value) {
    if (!value || typeof value !== 'object') return null;
    const student = {};
    FIELD_ORDER.forEach((field) => {
      const raw = value[field];
      student[field] = raw === null || raw === undefined ? '' : String(raw).trim();
    });
    if (!student.student_id || !student.name || !student.gender || !student.age || !student.class_name) return null;
    if (!VALID_GENDERS.includes(student.gender)) return null;
    if (!/^\d+$/.test(student.age)) return null;
    student.age = Number(student.age);
    if (student.age < 1 || student.age > 120 || !Number.isInteger(student.age)) return null;
    return student;
  }

  function readStudents() {
    const raw = safeStorageGet();
    if (!raw) return cloneSeed();
    try {
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) return cloneSeed();
      const valid = parsed.map(normalizeStudent).filter(Boolean);
      const ids = new Set();
      const unique = valid.filter((student) => {
        if (ids.has(student.student_id)) return false;
        ids.add(student.student_id);
        return true;
      });
      return unique.length === valid.length ? unique : cloneSeed();
    } catch (_error) {
      return cloneSeed();
    }
  }

  function persistStudents(nextStudents) {
    students = nextStudents.map((student) => ({ ...student }));
    memoryData = students.map((student) => ({ ...student }));
    safeStorageSet(JSON.stringify(students));
    renderAll();
  }

  function escapeHtml(value) {
    return String(value ?? '')
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#039;');
  }

  function encodeId(value) {
    return encodeURIComponent(String(value));
  }

  function decodeId(value) {
    try { return decodeURIComponent(value); } catch (_error) { return ''; }
  }

  function initials(name) {
    return String(name || '学').slice(0, 1);
  }

  function formatPhone(phone) {
    return phone || '—';
  }

  function renderAll() {
    renderDate();
    renderDashboard();
    renderClassFilter();
    renderStudents();
  }

  function renderDate() {
    const now = new Date();
    const dateFormatter = new Intl.DateTimeFormat('zh-CN', { year: 'numeric', month: 'long', day: 'numeric' });
    const weekdayFormatter = new Intl.DateTimeFormat('zh-CN', { weekday: 'long' });
    if (els.heroDate) els.heroDate.textContent = dateFormatter.format(now);
    const kicker = document.querySelector('.hero-kicker');
    if (kicker) kicker.firstChild.textContent = `${weekdayFormatter.format(now)} · `;
    if (els.lastUpdated) els.lastUpdated.textContent = now.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
  }

  function renderDashboard() {
    const total = students.length;
    const male = students.filter((student) => student.gender === '男').length;
    const female = students.filter((student) => student.gender === '女').length;
    const classes = Array.from(new Set(students.map((student) => student.class_name))).sort((a, b) => a.localeCompare(b, 'zh-CN'));
    const setText = (selector, value) => { const node = $(selector); if (node) node.textContent = value; };
    setText('#stat-total', total);
    setText('#stat-male', male);
    setText('#stat-female', female);
    setText('#stat-classes', classes.length);
    if (els.navCount) els.navCount.textContent = total;

    if (els.classChart) {
      const counts = classes.map((className) => ({ className, count: students.filter((student) => student.class_name === className).length }));
      const maxCount = Math.max(1, ...counts.map((entry) => entry.count));
      els.classChart.innerHTML = counts.length
        ? counts.map((entry) => `<div class="bar-group"><span class="bar-value">${entry.count}</span><span class="bar" style="height:${Math.max(10, Math.round((entry.count / maxCount) * 100))}%"></span><span class="bar-label" title="${escapeHtml(entry.className)}">${escapeHtml(entry.className)}</span></div>`).join('')
        : '<div class="chart-empty">暂无班级数据</div>';
    }

    if (els.recentList) {
      const recent = students.slice(0, 4);
      els.recentList.innerHTML = recent.length
        ? recent.map((student) => `<div class="recent-item"><span class="recent-avatar">${escapeHtml(initials(student.name))}</span><span class="recent-copy"><strong>${escapeHtml(student.name)}</strong><span>学号 ${escapeHtml(student.student_id)}</span></span><span class="recent-class">${escapeHtml(student.class_name)}</span></div>`).join('')
        : '<div class="chart-empty">暂无学生数据</div>';
    }
  }

  function renderClassFilter() {
    if (!els.classFilter) return;
    const previous = els.classFilter.value;
    const classes = Array.from(new Set(students.map((student) => student.class_name))).sort((a, b) => a.localeCompare(b, 'zh-CN'));
    els.classFilter.innerHTML = '<option value="">全部班级</option>' + classes.map((className) => `<option value="${escapeHtml(className)}">${escapeHtml(className)}</option>`).join('');
    if (classes.includes(previous)) els.classFilter.value = previous;
  }

  function getFilteredStudents() {
    const query = (els.search?.value || '').trim().toLocaleLowerCase();
    const className = els.classFilter?.value || '';
    const gender = els.genderFilter?.value || '';
    return students.filter((student) => {
      const matchesQuery = !query || student.name.toLocaleLowerCase().includes(query) || student.student_id.toLocaleLowerCase().includes(query);
      return matchesQuery && (!className || student.class_name === className) && (!gender || student.gender === gender);
    });
  }

  function renderStudents() {
    const filtered = getFilteredStudents();
    const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
    if (currentPage > totalPages) currentPage = totalPages;
    const start = (currentPage - 1) * PAGE_SIZE;
    const visible = filtered.slice(start, start + PAGE_SIZE);
    if (els.tbody) {
      els.tbody.innerHTML = visible.map((student) => {
        const genderClass = student.gender === '男' ? 'gender-male' : student.gender === '女' ? 'gender-female' : 'gender-other';
        const avatarClass = student.gender === '女' ? 'avatar-female' : student.gender === '其他' ? 'avatar-other' : '';
        const encodedId = encodeId(student.student_id);
        return `<tr data-student-id="${encodedId}"><td><input class="row-check" type="checkbox" data-student-id="${encodedId}" aria-label="选择${escapeHtml(student.name)}" ${selectedIds.has(student.student_id) ? 'checked' : ''}></td><td class="student-id">${escapeHtml(student.student_id)}</td><td><span class="student-name"><span class="student-avatar ${avatarClass}">${escapeHtml(initials(student.name))}</span>${escapeHtml(student.name)}</span></td><td><span class="gender-pill ${genderClass}">${escapeHtml(student.gender)}</span></td><td>${escapeHtml(student.age)}</td><td class="class-tag">${escapeHtml(student.class_name)}</td><td class="phone-text">${escapeHtml(formatPhone(student.phone))}</td><td class="action-col"><span class="row-actions"><button class="row-action" type="button" data-row-action="view" data-student-id="${encodedId}" aria-label="查看${escapeHtml(student.name)}" title="查看"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M2.8 12s3.2-5.2 9.2-5.2S21.2 12 21.2 12s-3.2 5.2-9.2 5.2S2.8 12 2.8 12Z"/><circle cx="12" cy="12" r="2.3"/></svg></button><button class="row-action" type="button" data-row-action="edit" data-student-id="${encodedId}" aria-label="编辑${escapeHtml(student.name)}" title="编辑"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="m14.7 5.3 4 4M4 20l3.8-.8L19.6 7.4a2.2 2.2 0 0 0-3-3L4.8 16.2 4 20Z" stroke-linecap="round" stroke-linejoin="round"/></svg></button><button class="row-action delete" type="button" data-row-action="delete" data-student-id="${encodedId}" aria-label="删除${escapeHtml(student.name)}" title="删除"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M4.5 7h15M9 7V4.5h6V7m-8.5 0 .8 12.2h9.4L17.5 7M10 10.5v5.5m4-5.5v5.5" stroke-linecap="round" stroke-linejoin="round"/></svg></button></span></td></tr>`;
      }).join('');
    }
    if (els.tableEmpty) els.tableEmpty.hidden = visible.length !== 0;
    if (els.tableSummary) {
      const from = filtered.length ? start + 1 : 0;
      const to = Math.min(start + PAGE_SIZE, filtered.length);
      els.tableSummary.textContent = `显示 ${from}-${to} 条，共 ${filtered.length} 条`;
    }
    if (els.selectAll) els.selectAll.checked = visible.length > 0 && visible.every((student) => selectedIds.has(student.student_id));
    renderPagination(totalPages);
  }

  function renderPagination(totalPages) {
    if (!els.pagination) return;
    if (totalPages <= 1) {
      els.pagination.innerHTML = '';
      return;
    }
    const buttons = [];
    buttons.push(`<button class="page-button" type="button" data-page="${currentPage - 1}" aria-label="上一页" ${currentPage === 1 ? 'disabled' : ''}>‹</button>`);
    const pageNumbers = totalPages <= 5
      ? Array.from({ length: totalPages }, (_, index) => index + 1)
      : Array.from(new Set([1, currentPage - 1, currentPage, currentPage + 1, totalPages].filter((page) => page >= 1 && page <= totalPages))).sort((a, b) => a - b);
    let previous = 0;
    pageNumbers.forEach((page) => {
      if (previous && page - previous > 1) buttons.push('<span class="page-ellipsis">…</span>');
      buttons.push(`<button class="page-button ${page === currentPage ? 'is-active' : ''}" type="button" data-page="${page}" aria-label="第${page}页" ${page === currentPage ? 'aria-current="page"' : ''}>${page}</button>`);
      previous = page;
    });
    buttons.push(`<button class="page-button" type="button" data-page="${currentPage + 1}" aria-label="下一页" ${currentPage === totalPages ? 'disabled' : ''}>›</button>`);
    els.pagination.innerHTML = buttons.join('');
  }

  function switchView(viewName) {
    const labels = { dashboard: '仪表盘', students: '学生档案', 'data-center': '数据中心', about: '使用说明' };
    if (!labels[viewName]) return;
    currentView = viewName;
    currentPage = 1;
    $$('.view').forEach((view) => {
      const active = view.dataset.view === viewName;
      view.hidden = !active;
      view.classList.toggle('is-visible', active);
    });
    $$('.nav-item').forEach((item) => item.classList.toggle('is-active', item.dataset.viewTarget === viewName));
    if (els.currentSection) els.currentSection.textContent = labels[viewName];
    if (els.pageHeading) els.pageHeading.innerHTML = viewName === 'dashboard' ? '早上好，管理员 <span class="wave" aria-hidden="true">✦</span>' : labels[viewName];
    closeMobileMenu();
    if (viewName === 'students') {
      window.setTimeout(() => els.search?.focus(), 100);
    }
  }

  function clearFormErrors() {
    $$('.field', els.studentForm).forEach((field) => field.classList.remove('has-error'));
    $$('.field-error', els.studentForm).forEach((error) => { error.textContent = ''; });
  }

  function setFormErrors(errors) {
    clearFormErrors();
    Object.entries(errors).forEach(([fieldName, message]) => {
      const field = $(`[name="${fieldName}"]`, els.studentForm);
      const error = $(`[data-error-for="${fieldName}"]`, els.studentForm);
      field?.closest('.field')?.classList.add('has-error');
      if (error) error.textContent = message;
    });
  }

  function validateStudent(data, excludedId = '') {
    const errors = {};
    if (!data.student_id) errors.student_id = '请输入学号';
    else if (data.student_id.length > 24) errors.student_id = '学号不能超过 24 个字符';
    else if (students.some((student) => student.student_id === data.student_id && student.student_id !== excludedId)) errors.student_id = '这个学号已经存在';
    if (!data.name) errors.name = '请输入姓名';
    else if (data.name.length < 2 || data.name.length > 20) errors.name = '姓名需为 2–20 个字符';
    if (!VALID_GENDERS.includes(data.gender)) errors.gender = '请选择性别';
    if (!data.age) errors.age = '请输入年龄';
    else if (!/^\d+$/.test(data.age) || Number(data.age) < 1 || Number(data.age) > 120) errors.age = '年龄需为 1–120 的整数';
    if (!data.class_name) errors.class_name = '请输入班级';
    else if (data.class_name.length > 30) errors.class_name = '班级不能超过 30 个字符';
    if (data.phone && !/^[0-9+()\-\s]{6,24}$/.test(data.phone)) errors.phone = '请输入有效的联系电话';
    return errors;
  }

  function getFormData() {
    return {
      student_id: $('#field-student-id')?.value.trim() || '',
      name: $('#field-name')?.value.trim() || '',
      gender: $('#field-gender')?.value || '',
      age: $('#field-age')?.value.trim() || '',
      class_name: $('#field-class')?.value.trim() || '',
      phone: $('#field-phone')?.value.trim() || ''
    };
  }

  function fillForm(student) {
    $('#field-student-id').value = student?.student_id || '';
    $('#field-name').value = student?.name || '';
    $('#field-gender').value = student?.gender || '';
    $('#field-age').value = student?.age || '';
    $('#field-class').value = student?.class_name || '';
    $('#field-phone').value = student?.phone || '';
  }

  function openStudentForm(student = null) {
    editingStudentId = student?.student_id || '';
    els.editingId.value = editingStudentId;
    els.modalTitle.textContent = student ? '编辑学生' : '新增学生';
    els.modalSubmit.textContent = student ? '保存修改' : '保存学生';
    fillForm(student);
    clearFormErrors();
    openModal(els.studentModal);
    window.setTimeout(() => $('#field-student-id')?.focus(), 80);
  }

  function openDetail(student) {
    if (!student) return;
    detailStudentId = student.student_id;
    els.detailTitle.textContent = student.name;
    els.detailContent.innerHTML = `<div class="detail-list"><div class="detail-item"><span>学号</span><strong>${escapeHtml(student.student_id)}</strong></div><div class="detail-item"><span>姓名</span><strong>${escapeHtml(student.name)}</strong></div><div class="detail-item"><span>性别</span><strong>${escapeHtml(student.gender)}</strong></div><div class="detail-item"><span>年龄</span><strong>${escapeHtml(student.age)} 岁</strong></div><div class="detail-item detail-item-wide"><span>班级</span><strong>${escapeHtml(student.class_name)}</strong></div><div class="detail-item detail-item-wide"><span>联系电话</span><strong>${escapeHtml(formatPhone(student.phone))}</strong></div></div>`;
    openModal(els.detailModal);
  }

  function openModal(modal) {
    els.modalBackdrop.hidden = false;
    els.studentModal.hidden = modal !== els.studentModal;
    els.detailModal.hidden = modal !== els.detailModal;
    document.body.style.overflow = 'hidden';
  }

  function closeModal() {
    els.modalBackdrop.hidden = true;
    els.studentModal.hidden = true;
    els.detailModal.hidden = true;
    document.body.style.overflow = '';
    editingStudentId = '';
    detailStudentId = '';
  }

  function showToast(message, type = 'info') {
    if (!els.toastRegion) return;
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.innerHTML = `<span class="toast-icon">${type === 'success' ? '✓' : type === 'error' ? '!' : 'i'}</span><span>${escapeHtml(message)}</span>`;
    els.toastRegion.appendChild(toast);
    window.clearTimeout(toastTimer);
    toastTimer = window.setTimeout(() => {
      toast.classList.add('is-leaving');
      window.setTimeout(() => toast.remove(), 240);
    }, 3200);
  }

  function handleFormSubmit(event) {
    event.preventDefault();
    const data = getFormData();
    const errors = validateStudent(data, editingStudentId);
    if (Object.keys(errors).length) {
      setFormErrors(errors);
      const firstError = Object.keys(errors)[0];
      $(`[name="${firstError}"]`, els.studentForm)?.focus();
      return;
    }
    const normalized = normalizeStudent(data);
    if (!normalized) {
      showToast('请检查表单内容后重试', 'error');
      return;
    }
    if (editingStudentId) {
      const index = students.findIndex((student) => student.student_id === editingStudentId);
      if (index < 0) {
        showToast('记录已不存在，请刷新后重试', 'error');
        closeModal();
        return;
      }
      const next = students.slice();
      next[index] = normalized;
      persistStudents(next);
      showToast('学生档案已更新', 'success');
    } else {
      persistStudents([normalized, ...students]);
      showToast('学生档案已新增', 'success');
    }
    closeModal();
  }

  function deleteStudent(studentId) {
    const student = students.find((entry) => entry.student_id === studentId);
    if (!student) return;
    if (!window.confirm(`确定删除“${student.name}”的学生档案吗？此操作无法撤销。`)) return;
    persistStudents(students.filter((entry) => entry.student_id !== studentId));
    selectedIds.delete(studentId);
    showToast('学生档案已删除', 'success');
  }

  function resetData() {
    if (!window.confirm('确定恢复 8 条内置演示数据吗？当前浏览器中的修改会被清除。')) return;
    selectedIds.clear();
    persistStudents(cloneSeed());
    currentPage = 1;
    showToast('演示数据已恢复', 'success');
  }

  function csvCell(value) {
    const text = String(value ?? '');
    return /[",\n\r]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
  }

  function exportCsv() {
    const header = FIELD_ORDER.map((field) => FIELD_LABELS[field]).join(',');
    const rows = students.map((student) => FIELD_ORDER.map((field) => csvCell(student[field])).join(','));
    const blob = new Blob([`\uFEFF${[header, ...rows].join('\r\n')}`], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `campusflow-students-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
    showToast(`已导出 ${students.length} 条学生档案`, 'success');
  }

  function parseCsv(text) {
    const rows = [];
    let row = [];
    let cell = '';
    let quoted = false;
    const source = String(text || '').replace(/^\uFEFF/, '');
    for (let index = 0; index < source.length; index += 1) {
      const char = source[index];
      const next = source[index + 1];
      if (quoted) {
        if (char === '"' && next === '"') { cell += '"'; index += 1; }
        else if (char === '"') quoted = false;
        else cell += char;
      } else if (char === '"' && cell === '') quoted = true;
      else if (char === ',') { row.push(cell); cell = ''; }
      else if (char === '\n' || char === '\r') {
        if (char === '\r' && next === '\n') index += 1;
        row.push(cell);
        if (row.some((value) => value.trim() !== '')) rows.push(row);
        row = [];
        cell = '';
      } else cell += char;
    }
    if (cell !== '' || row.length) {
      row.push(cell);
      if (row.some((value) => value.trim() !== '')) rows.push(row);
    }
    return rows;
  }

  function normalizedHeader(value) {
    return String(value || '').trim().toLocaleLowerCase().replace(/[\s_-]/g, '');
  }

  function importCsvFile(file) {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const rows = parseCsv(reader.result);
        if (rows.length < 2) throw new Error('CSV 至少需要一行表头和一行数据');
        const aliases = {
          学号: 'student_id', studentid: 'student_id', id: 'student_id',
          姓名: 'name', name: 'name',
          性别: 'gender', gender: 'gender',
          年龄: 'age', age: 'age',
          班级: 'class_name', classname: 'class_name', class: 'class_name',
          联系电话: 'phone', 电话: 'phone', phone: 'phone'
        };
        const headers = rows[0].map(normalizedHeader);
        const positions = FIELD_ORDER.map((field) => headers.findIndex((header) => aliases[header] === field));
        if (positions.some((position) => position < 0)) throw new Error('表头必须包含：学号、姓名、性别、年龄、班级、联系电话');
        const existingIds = new Set(students.map((student) => student.student_id));
        const imported = [];
        const importedIds = new Set();
        rows.slice(1).forEach((row, rowIndex) => {
          const data = {};
          FIELD_ORDER.forEach((field, fieldIndex) => { data[field] = (row[positions[fieldIndex]] || '').trim(); });
          const errors = validateStudent(data);
          if (data.student_id && existingIds.has(data.student_id)) errors.student_id = '学号已存在';
          if (data.student_id && importedIds.has(data.student_id)) errors.student_id = '文件内学号重复';
          if (Object.keys(errors).length) {
            const reason = Object.values(errors)[0];
            throw new Error(`第 ${rowIndex + 2} 行：${reason}`);
          }
          const normalized = normalizeStudent(data);
          imported.push(normalized);
          importedIds.add(normalized.student_id);
        });
        persistStudents([...imported, ...students]);
        showToast(`成功导入 ${imported.length} 条学生档案`, 'success');
      } catch (error) {
        showToast(error.message || 'CSV 文件读取失败', 'error');
      } finally {
        if (els.csvInput) els.csvInput.value = '';
      }
    };
    reader.onerror = () => {
      showToast('CSV 文件读取失败', 'error');
      if (els.csvInput) els.csvInput.value = '';
    };
    reader.readAsText(file, 'UTF-8');
  }

  function clearFilters() {
    if (els.search) els.search.value = '';
    if (els.classFilter) els.classFilter.value = '';
    if (els.genderFilter) els.genderFilter.value = '';
    currentPage = 1;
    renderStudents();
  }

  function closeMobileMenu() {
    els.sidebar?.classList.remove('is-open');
    els.mobileBackdrop?.classList.remove('is-visible');
    els.mobileMenu?.setAttribute('aria-expanded', 'false');
  }

  function toggleMobileMenu() {
    const open = !els.sidebar?.classList.contains('is-open');
    els.sidebar?.classList.toggle('is-open', open);
    els.mobileBackdrop?.classList.toggle('is-visible', open);
    els.mobileMenu?.setAttribute('aria-expanded', String(open));
  }

  document.addEventListener('click', (event) => {
    const viewButton = event.target.closest('[data-view-target]');
    if (viewButton) { switchView(viewButton.dataset.viewTarget); return; }
    const actionButton = event.target.closest('[data-action]');
    if (actionButton) {
      const action = actionButton.dataset.action;
      if (action === 'open-add') openStudentForm();
      else if (action === 'close-modal') closeModal();
      else if (action === 'reset-data') resetData();
      else if (action === 'export-csv') exportCsv();
      else if (action === 'clear-filters') clearFilters();
      else if (action === 'show-notice') showToast('静态演示数据会自动保存在当前浏览器中');
      return;
    }
    const rowAction = event.target.closest('[data-row-action]');
    if (rowAction) {
      const student = students.find((entry) => entry.student_id === decodeId(rowAction.dataset.studentId));
      if (!student) return;
      if (rowAction.dataset.rowAction === 'view') openDetail(student);
      else if (rowAction.dataset.rowAction === 'edit') openStudentForm(student);
      else if (rowAction.dataset.rowAction === 'delete') deleteStudent(student.student_id);
      return;
    }
    const pageButton = event.target.closest('[data-page]');
    if (pageButton && !pageButton.disabled) {
      currentPage = Number(pageButton.dataset.page) || 1;
      renderStudents();
    }
  });

  els.studentForm?.addEventListener('submit', handleFormSubmit);
  els.modalBackdrop?.addEventListener('click', closeModal);
  els.detailEdit?.addEventListener('click', () => {
    const student = students.find((entry) => entry.student_id === detailStudentId);
    if (student) openStudentForm(student);
  });
  els.search?.addEventListener('input', () => { currentPage = 1; renderStudents(); });
  els.classFilter?.addEventListener('change', () => { currentPage = 1; renderStudents(); });
  els.genderFilter?.addEventListener('change', () => { currentPage = 1; renderStudents(); });
  els.selectAll?.addEventListener('change', () => {
    const filtered = getFilteredStudents();
    const start = (currentPage - 1) * PAGE_SIZE;
    filtered.slice(start, start + PAGE_SIZE).forEach((student) => {
      if (els.selectAll.checked) selectedIds.add(student.student_id);
      else selectedIds.delete(student.student_id);
    });
    renderStudents();
  });
  els.tbody?.addEventListener('change', (event) => {
    const checkbox = event.target.closest('.row-check');
    if (!checkbox) return;
    const id = decodeId(checkbox.dataset.studentId);
    if (checkbox.checked) selectedIds.add(id); else selectedIds.delete(id);
    renderStudents();
  });
  els.csvInput?.addEventListener('change', () => importCsvFile(els.csvInput.files?.[0]));
  els.mobileMenu?.addEventListener('click', toggleMobileMenu);
  els.mobileBackdrop?.addEventListener('click', closeMobileMenu);
  window.addEventListener('storage', (event) => {
    if (event.key !== STORAGE_KEY) return;
    students = readStudents();
    memoryData = students.map((student) => ({ ...student }));
    renderAll();
  });
  document.addEventListener('keydown', (event) => {
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
      event.preventDefault();
      switchView('students');
      els.search?.focus();
    }
    if (event.key === 'Escape') {
      if (!els.studentModal.hidden || !els.detailModal.hidden) closeModal();
      else closeMobileMenu();
    }
  });

  // Keep a memory copy for restricted/private browsing contexts.
  if (!students.length && memoryData.length) students = memoryData.map((student) => ({ ...student }));
  renderAll();
})();
