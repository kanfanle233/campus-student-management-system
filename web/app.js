/*
 * 校园管家 frontend
 *
 * The page talks to a replaceable adapter. The default adapter is the local
 * Flask API. Set window.APP_MODE = 'local' before loading this file when the
 * same view should run as a static demo backed by localStorage.
 */
(function () {
  'use strict';

  var PAGE_SIZE = 10;
  var STORAGE_KEY = 'campus-student-manager.students.v1';
  var MODE = window.APP_MODE === 'local' ? 'local' : 'api';
  var activeModal = null;
  var lastFocusedElement = null;
  var searchTimer = null;
  var toastTimers = new WeakMap();

  var state = {
    view: 'dashboard',
    page: 1,
    pageSize: PAGE_SIZE,
    query: '',
    gender: '',
    className: '',
    students: [],
    total: 0,
    totalPages: 1,
    stats: null,
    classes: [],
    loadingStudents: false,
    editingId: null,
    detailStudent: null,
    deletingStudent: null
  };

  function byId(id) {
    return document.getElementById(id);
  }

  function query(selector, root) {
    return (root || document).querySelector(selector);
  }

  function queryAll(selector, root) {
    return Array.prototype.slice.call((root || document).querySelectorAll(selector));
  }

  function escapeHtml(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  function idValue(value) {
    return encodeURIComponent(String(value == null ? '' : value));
  }

  function decodeId(value) {
    try {
      return decodeURIComponent(value);
    } catch (_error) {
      return value;
    }
  }

  function numberValue(value, fallback) {
    var parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : (fallback || 0);
  }

  function formatNumber(value) {
    return numberValue(value).toLocaleString('zh-CN');
  }

  function firstCharacter(value) {
    var text = String(value == null ? '' : value).trim();
    return text ? text.slice(0, 1).toUpperCase() : '—';
  }

  function humanDate(value) {
    if (!value) return '刚刚';
    var date = new Date(value);
    if (Number.isNaN(date.getTime())) return '刚刚';
    var now = new Date();
    var delta = now.getTime() - date.getTime();
    if (delta >= 0 && delta < 60 * 1000) return '刚刚';
    if (delta >= 0 && delta < 60 * 60 * 1000) return Math.floor(delta / (60 * 1000)) + '分钟前';
    if (delta >= 0 && delta < 24 * 60 * 60 * 1000) return Math.floor(delta / (60 * 60 * 1000)) + '小时前';
    if (delta >= 0 && delta < 7 * 24 * 60 * 60 * 1000) return Math.floor(delta / (24 * 60 * 60 * 1000)) + '天前';
    return (date.getMonth() + 1) + '月' + date.getDate() + '日';
  }

  function todayText() {
    var date = new Date();
    var weekdays = ['日', '一', '二', '三', '四', '五', '六'];
    return date.getFullYear() + '年' + (date.getMonth() + 1) + '月' + date.getDate() + '日 星期' + weekdays[date.getDay()];
  }

  function errorMessage(error, fallback) {
    if (!error) return fallback || '操作失败，请稍后重试';
    return error.message || fallback || '操作失败，请稍后重试';
  }

  function AppError(message, details) {
    this.name = 'AppError';
    this.message = message || '请求失败';
    this.details = details || null;
  }

  AppError.prototype = Object.create(Error.prototype);
  AppError.prototype.constructor = AppError;

  function unwrap(payload) {
    if (payload && payload.data !== undefined && !Array.isArray(payload.data)) return payload.data;
    return payload;
  }

  /* Single-record endpoints in the Flask layer may use either
   * {ok, student}, {ok, data: student}, or {ok, data: {student}}. Keep that
   * wire-format detail inside the adapter so the view always sees one shape. */
  function extractStudent(payload) {
    var root = payload || {};
    if (root.student && typeof root.student === 'object') return root.student;
    if (root.data && typeof root.data === 'object' && !Array.isArray(root.data)) {
      if (root.data.student && typeof root.data.student === 'object') return root.data.student;
      if (root.data.data && typeof root.data.data === 'object' && !Array.isArray(root.data.data)) return root.data.data;
      return root.data;
    }
    if (root.result && typeof root.result === 'object') return root.result;
    return root;
  }

  function pickFirst(source, keys, fallback) {
    if (!source || typeof source !== 'object') return fallback;
    for (var i = 0; i < keys.length; i += 1) {
      if (source[keys[i]] !== undefined && source[keys[i]] !== null) return source[keys[i]];
    }
    return fallback;
  }

  function normaliseStudent(raw) {
    var item = raw || {};
    return {
      student_id: String(pickFirst(item, ['student_id', 'studentId', 'id'], '')),
      name: String(pickFirst(item, ['name', 'student_name', 'studentName'], '')),
      gender: String(pickFirst(item, ['gender', 'sex'], '')),
      age: pickFirst(item, ['age'], ''),
      class_name: String(pickFirst(item, ['class_name', 'className', 'class'], '')),
      phone: String(pickFirst(item, ['phone', 'telephone', 'tel'], '')),
      created_at: pickFirst(item, ['created_at', 'createdAt', 'create_time', 'created'], null),
      updated_at: pickFirst(item, ['updated_at', 'updatedAt', 'update_time', 'updated'], null)
    };
  }

  function normaliseList(payload, requestedPage, requestedPageSize) {
    var root = payload || {};
    var nested = root && root.data && typeof root.data === 'object' && !Array.isArray(root.data) ? root.data : root;
    var rawItems = Array.isArray(payload) ? payload : null;
    if (!rawItems) {
      rawItems = pickFirst(nested, ['items', 'students', 'results', 'records', 'list'], null);
    }
    if (!Array.isArray(rawItems) && nested && Array.isArray(nested.data)) rawItems = nested.data;
    if (!Array.isArray(rawItems)) rawItems = [];
    var total = pickFirst(nested, ['total', 'total_count', 'totalCount', 'count'], null);
    if (total === null && root && root.meta) total = pickFirst(root.meta, ['total', 'total_count', 'totalCount'], null);
    if (total === null) total = rawItems.length;
    var page = numberValue(pickFirst(nested, ['page', 'current_page', 'currentPage'], requestedPage), requestedPage);
    var pageSize = numberValue(pickFirst(nested, ['page_size', 'pageSize', 'per_page', 'perPage'], requestedPageSize), requestedPageSize);
    var pages = pickFirst(nested, ['total_pages', 'totalPages', 'pages'], null);
    if (pages === null) pages = Math.max(1, Math.ceil(numberValue(total) / Math.max(1, pageSize)));
    var rawClasses = pickFirst(nested, ['classes', 'class_names', 'classNames'], []);
    return {
      items: rawItems.map(normaliseStudent),
      total: numberValue(total),
      page: Math.max(1, numberValue(page, requestedPage)),
      pageSize: Math.max(1, numberValue(pageSize, requestedPageSize)),
      totalPages: Math.max(1, numberValue(pages)),
      classes: Array.isArray(rawClasses) ? rawClasses.map(String) : []
    };
  }

  function normaliseStats(payload) {
    var root = unwrap(payload) || {};
    var total = pickFirst(root, ['total', 'total_students', 'totalStudents', 'student_count', 'studentCount'], null);
    var male = pickFirst(root, ['male', 'male_count', 'maleCount', 'boys', '男生'], null);
    var female = pickFirst(root, ['female', 'female_count', 'femaleCount', 'girls', '女生'], null);
    var classes = pickFirst(root, ['classes', 'class_count', 'classCount', 'total_classes', 'totalClasses'], null);
    var classList = pickFirst(root, ['class_names', 'classNames'], null);
    if (classes === null && Array.isArray(classList)) classes = classList.length;
    return {
      total: total === null ? null : numberValue(total),
      male: male === null ? null : numberValue(male),
      female: female === null ? null : numberValue(female),
      classes: classes === null ? null : (Array.isArray(classes) ? classes.length : numberValue(classes)),
      classList: Array.isArray(classList) ? classList.map(String) : (Array.isArray(classes) ? classes.map(String) : [])
    };
  }

  function jsonHeaders() {
    return { 'Content-Type': 'application/json', Accept: 'application/json' };
  }

  function parseResponse(response) {
    var contentType = response.headers.get('content-type') || '';
    if (contentType.indexOf('application/json') !== -1) return response.json();
    return response.text().then(function (text) {
      if (!text) return null;
      try { return JSON.parse(text); } catch (_error) { return { message: text }; }
    });
  }

  function requestJSON(url, options) {
    return fetch(url, options).then(function (response) {
      return parseResponse(response).then(function (payload) {
        if (!response.ok) {
          var message = pickFirst(payload, ['message', 'error', 'detail'], '请求失败（' + response.status + '）');
          var details = pickFirst(payload, ['errors', 'details'], null);
          throw new AppError(String(message), details);
        }
        return payload;
      });
    }).catch(function (error) {
      if (error instanceof AppError) throw error;
      throw new AppError('无法连接本地服务，请确认 Flask 已启动');
    });
  }

  function queryString(params) {
    var queryParams = new URLSearchParams();
    Object.keys(params || {}).forEach(function (key) {
      var value = params[key];
      if (value !== undefined && value !== null && value !== '') queryParams.set(key, value);
    });
    var result = queryParams.toString();
    return result ? '?' + result : '';
  }

  var ApiAdapter = {
    mode: 'api',
    list: function (params) {
      var requestParams = Object.assign({ page: 1, page_size: PAGE_SIZE }, params || {});
      return requestJSON('/api/students' + queryString({
        q: requestParams.q,
        gender: requestParams.gender,
        class_name: requestParams.class_name,
        page: requestParams.page,
        page_size: requestParams.page_size
      }), { headers: { Accept: 'application/json' } }).then(function (payload) {
        return normaliseList(payload, requestParams.page, requestParams.page_size);
      });
    },
    get: function (id) {
      return requestJSON('/api/students/' + encodeURIComponent(id), { headers: { Accept: 'application/json' } }).then(function (payload) { return normaliseStudent(extractStudent(payload)); });
    },
    create: function (student) {
      return requestJSON('/api/students', { method: 'POST', headers: jsonHeaders(), body: JSON.stringify(student) }).then(function (payload) { return normaliseStudent(extractStudent(payload)); });
    },
    update: function (id, student) {
      return requestJSON('/api/students/' + encodeURIComponent(id), { method: 'PUT', headers: jsonHeaders(), body: JSON.stringify(student) }).then(function (payload) { return normaliseStudent(extractStudent(payload)); });
    },
    remove: function (id) {
      return requestJSON('/api/students/' + encodeURIComponent(id), { method: 'DELETE', headers: { Accept: 'application/json' } });
    },
    stats: function () {
      return requestJSON('/api/stats', { headers: { Accept: 'application/json' } }).then(normaliseStats);
    },
    import: function (file) {
      var body = new FormData();
      body.append('file', file, file.name);
      return requestJSON('/api/students/import', { method: 'POST', headers: { Accept: 'application/json' }, body: body }).then(function (payload) {
        var root = unwrap(payload) || {};
        return { imported: numberValue(pickFirst(root, ['imported', 'count', 'created'], 0)), message: pickFirst(root, ['message'], '导入成功') };
      });
    },
    export: function () {
      return fetch('/api/students/export', { headers: { Accept: 'text/csv, application/octet-stream, application/json' } }).then(function (response) {
        if (!response.ok) return parseResponse(response).then(function (payload) { throw new AppError(String(pickFirst(payload, ['message', 'error'], '导出失败'))); });
        return response.blob();
      }).catch(function (error) {
        if (error instanceof AppError) throw error;
        throw new AppError('无法连接本地服务，请确认 Flask 已启动');
      });
    }
  };

  var SEED_STUDENTS = [
    { student_id: '2026001', name: '林清禾', gender: '女', age: 18, class_name: '计算机科学1班', phone: '138-0000-0001', created_at: '2026-08-30T09:24:00+08:00' },
    { student_id: '2026002', name: '周予安', gender: '男', age: 19, class_name: '软件工程2班', phone: '138-0000-0002', created_at: '2026-08-29T15:42:00+08:00' },
    { student_id: '2026003', name: '沈知行', gender: '男', age: 18, class_name: '数据科学1班', phone: '138-0000-0003', created_at: '2026-08-28T10:15:00+08:00' },
    { student_id: '2026004', name: '许星晚', gender: '女', age: 18, class_name: '计算机科学1班', phone: '138-0000-0004', created_at: '2026-08-27T14:08:00+08:00' },
    { student_id: '2026005', name: '顾言川', gender: '男', age: 20, class_name: '人工智能2班', phone: '138-0000-0005', created_at: '2026-08-26T11:36:00+08:00' },
    { student_id: '2026006', name: '宋语宁', gender: '女', age: 19, class_name: '软件工程2班', phone: '138-0000-0006', created_at: '2026-08-25T16:23:00+08:00' },
    { student_id: '2026007', name: '谢嘉树', gender: '男', age: 18, class_name: '信息安全1班', phone: '138-0000-0007', created_at: '2026-08-24T09:11:00+08:00' },
    { student_id: '2026008', name: '苏晚晴', gender: '女', age: 19, class_name: '数据科学1班', phone: '138-0000-0008', created_at: '2026-08-23T13:50:00+08:00' },
    { student_id: '2026009', name: '程一航', gender: '男', age: 18, class_name: '人工智能2班', phone: '138-0000-0009', created_at: '2026-08-22T12:18:00+08:00' },
    { student_id: '2026010', name: '唐芷柔', gender: '女', age: 18, class_name: '信息安全1班', phone: '138-0000-0010', created_at: '2026-08-21T17:32:00+08:00' },
    { student_id: '2026011', name: '陆景澄', gender: '男', age: 20, class_name: '计算机科学1班', phone: '138-0000-0011', created_at: '2026-08-20T09:45:00+08:00' },
    { student_id: '2026012', name: '江映竹', gender: '女', age: 19, class_name: '软件工程2班', phone: '138-0000-0012', created_at: '2026-08-19T15:02:00+08:00' }
  ];

  function localRead() {
    try {
      var raw = window.localStorage.getItem(STORAGE_KEY);
      if (!raw) {
        var initial = SEED_STUDENTS.map(function (student) { return Object.assign({}, student); });
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(initial));
        return initial;
      }
      var parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed.map(normaliseStudent) : [];
    } catch (_error) {
      throw new AppError('无法读取浏览器演示数据，请检查浏览器存储权限');
    }
  }

  function localWrite(students) {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(students));
    } catch (_error) {
      throw new AppError('无法保存浏览器演示数据，请检查浏览器存储空间');
    }
  }

  function validateStudent(student, existingId) {
    var errors = {};
    var id = String(student.student_id == null ? '' : student.student_id).trim();
    var name = String(student.name == null ? '' : student.name).trim();
    var gender = String(student.gender == null ? '' : student.gender).trim();
    var className = String(student.class_name == null ? '' : student.class_name).trim();
    var phone = String(student.phone == null ? '' : student.phone).trim();
    var age = String(student.age == null ? '' : student.age).trim();
    if (!id) errors.student_id = '请输入学号';
    else if (id.length > 32) errors.student_id = '学号不能超过 32 个字符';
    if (!name) errors.name = '请输入姓名';
    else if (name.length > 30) errors.name = '姓名不能超过 30 个字符';
    if (!gender) errors.gender = '请选择性别';
    else if (gender !== '男' && gender !== '女' && gender !== '其他') errors.gender = '性别只能选择男、女或其他';
    if (!age) errors.age = '请输入年龄';
    else if (!/^\d+$/.test(age) || Number(age) < 1 || Number(age) > 120) errors.age = '年龄请输入 1—120 的整数';
    if (!className) errors.class_name = '请输入班级';
    else if (className.length > 60) errors.class_name = '班级不能超过 60 个字符';
    if (phone && !/^[0-9\s-]+$/.test(phone)) errors.phone = '电话仅支持数字、空格和连字符';
    return errors;
  }

  function localList(params) {
    var requestParams = Object.assign({ page: 1, page_size: PAGE_SIZE }, params || {});
    var all = localRead();
    var q = String(requestParams.q || '').trim().toLowerCase();
    var filtered = all.filter(function (student) {
      var matchesQuery = !q || String(student.name).toLowerCase().indexOf(q) !== -1 || String(student.student_id).toLowerCase().indexOf(q) !== -1;
      var matchesGender = !requestParams.gender || student.gender === requestParams.gender;
      var matchesClass = !requestParams.class_name || student.class_name === requestParams.class_name;
      return matchesQuery && matchesGender && matchesClass;
    });
    filtered.sort(function (a, b) {
      var aDate = new Date(a.created_at || 0).getTime();
      var bDate = new Date(b.created_at || 0).getTime();
      return bDate - aDate;
    });
    var page = Math.max(1, numberValue(requestParams.page, 1));
    var pageSize = Math.max(1, numberValue(requestParams.page_size, PAGE_SIZE));
    var start = (page - 1) * pageSize;
    var classes = all.map(function (student) { return student.class_name; }).filter(Boolean).filter(function (value, index, array) { return array.indexOf(value) === index; }).sort();
    return Promise.resolve({ items: filtered.slice(start, start + pageSize).map(normaliseStudent), total: filtered.length, page: page, pageSize: pageSize, totalPages: Math.max(1, Math.ceil(filtered.length / pageSize)), classes: classes });
  }

  var LocalAdapter = {
    mode: 'local',
    list: localList,
    get: function (id) {
      var student = localRead().filter(function (item) { return String(item.student_id) === String(id); })[0];
      return student ? Promise.resolve(normaliseStudent(student)) : Promise.reject(new AppError('没有找到这名学生'));
    },
    create: function (student) {
      var all = localRead();
      var errors = validateStudent(student);
      if (all.some(function (item) { return String(item.student_id) === String(student.student_id).trim(); })) errors.student_id = '该学号已经存在';
      if (Object.keys(errors).length) return Promise.reject(new AppError('请修正表单中的错误', errors));
      var record = normaliseStudent(Object.assign({}, student, { age: Number(student.age), created_at: new Date().toISOString() }));
      all.push(record);
      localWrite(all);
      return Promise.resolve(record);
    },
    update: function (id, student) {
      var all = localRead();
      var index = all.findIndex(function (item) { return String(item.student_id) === String(id); });
      if (index === -1) return Promise.reject(new AppError('没有找到这名学生'));
      var errors = validateStudent(student, id);
      if (String(student.student_id) !== String(id) && all.some(function (item) { return String(item.student_id) === String(student.student_id).trim(); })) errors.student_id = '该学号已经存在';
      if (Object.keys(errors).length) return Promise.reject(new AppError('请修正表单中的错误', errors));
      var updated = normaliseStudent(Object.assign({}, all[index], student, { age: Number(student.age), updated_at: new Date().toISOString() }));
      all[index] = updated;
      localWrite(all);
      return Promise.resolve(updated);
    },
    remove: function (id) {
      var all = localRead();
      var next = all.filter(function (item) { return String(item.student_id) !== String(id); });
      if (next.length === all.length) return Promise.reject(new AppError('没有找到这名学生'));
      localWrite(next);
      return Promise.resolve({});
    },
    stats: function () {
      var all = localRead();
      var classes = all.map(function (student) { return student.class_name; }).filter(Boolean).filter(function (value, index, array) { return array.indexOf(value) === index; });
      return Promise.resolve({ total: all.length, male: all.filter(function (item) { return item.gender === '男'; }).length, female: all.filter(function (item) { return item.gender === '女'; }).length, classes: classes.length, classList: classes.sort() });
    },
    import: function (file) {
      return readFileText(file).then(function (text) {
        var rows = parseCsv(text);
        if (!rows.length) throw new AppError('CSV 文件没有可导入的数据');
        var records = rows.map(csvRowToStudent);
        var all = localRead();
        var seen = {};
        records.forEach(function (student, index) {
          var errors = validateStudent(student);
          var key = String(student.student_id || '').trim();
          if (key && Object.prototype.hasOwnProperty.call(seen, key)) errors.student_id = 'CSV 内学号重复（第 ' + (seen[key] + 2) + ' 行）';
          if (key && all.some(function (item) { return String(item.student_id) === key; })) errors.student_id = '学号已存在于系统中';
          if (Object.keys(errors).length) {
            var firstError = Object.keys(errors)[0];
            throw new AppError('第 ' + (index + 2) + ' 行：' + errors[firstError]);
          }
          seen[key] = index;
        });
        var now = new Date().toISOString();
        var next = records.map(function (student) { return normaliseStudent(Object.assign({}, student, { age: Number(student.age), created_at: now })); });
        localWrite(all.concat(next));
        return { imported: next.length, message: '成功导入 ' + next.length + ' 条学生记录' };
      });
    },
    export: function () {
      var rows = localRead().map(function (student) { return [student.student_id, student.name, student.gender, student.age, student.class_name, student.phone]; });
      var csv = toCsv([['学号', '姓名', '性别', '年龄', '班级', '联系电话']].concat(rows));
      return Promise.resolve(new Blob(['\ufeff', csv], { type: 'text/csv;charset=utf-8' }));
    },
    resetDemo: function () {
      localWrite(SEED_STUDENTS.map(function (student) { return Object.assign({}, student); }));
    }
  };

  var Adapters = { api: ApiAdapter, local: LocalAdapter };
  var adapter = Adapters[MODE];

  /* Public hook for a static Pages shell or an embedding page. */
  window.StudentDataAdapters = Adapters;

  function readFileText(file) {
    return new Promise(function (resolve, reject) {
      var reader = new FileReader();
      reader.onload = function () { resolve(String(reader.result || '').replace(/^\ufeff/, '')); };
      reader.onerror = function () { reject(new AppError('无法读取 CSV 文件')); };
      reader.readAsText(file, 'UTF-8');
    });
  }

  function parseCsv(text) {
    var rows = [];
    var row = [];
    var cell = '';
    var quoted = false;
    for (var i = 0; i < text.length; i += 1) {
      var character = text[i];
      if (quoted) {
        if (character === '"' && text[i + 1] === '"') { cell += '"'; i += 1; }
        else if (character === '"') quoted = false;
        else cell += character;
      } else if (character === '"' && cell === '') {
        quoted = true;
      } else if (character === ',') {
        row.push(cell.trim()); cell = '';
      } else if (character === '\n' || character === '\r') {
        if (character === '\r' && text[i + 1] === '\n') i += 1;
        row.push(cell.trim()); cell = '';
        if (row.some(function (part) { return part !== ''; })) rows.push(row);
        row = [];
      } else {
        cell += character;
      }
    }
    if (cell !== '' || row.length) {
      row.push(cell.trim());
      if (row.some(function (part) { return part !== ''; })) rows.push(row);
    }
    if (!rows.length) return [];
    var header = rows[0].map(function (part) { return String(part).replace(/^\ufeff/, '').trim(); });
    var known = { '学号': 'student_id', 'student_id': 'student_id', 'studentId': 'student_id', '姓名': 'name', 'name': 'name', '性别': 'gender', 'gender': 'gender', '年龄': 'age', 'age': 'age', '班级': 'class_name', 'class_name': 'class_name', 'className': 'class_name', '联系电话': 'phone', 'phone': 'phone', 'telephone': 'phone' };
    var mapping = header.map(function (part) { return known[part] || part; });
    return rows.slice(1).map(function (parts) {
      var result = {};
      mapping.forEach(function (key, index) { if (key) result[key] = parts[index] || ''; });
      return result;
    });
  }

  function csvRowToStudent(row) {
    return { student_id: row.student_id || '', name: row.name || '', gender: row.gender || '', age: row.age || '', class_name: row.class_name || '', phone: row.phone || '' };
  }

  function csvCell(value) {
    var text = String(value == null ? '' : value);
    return /[",\r\n]/.test(text) ? '"' + text.replace(/"/g, '""') + '"' : text;
  }

  function toCsv(rows) {
    return rows.map(function (row) { return row.map(csvCell).join(','); }).join('\r\n') + '\r\n';
  }

  function setModeLabel() {
    var label = byId('modeLabel');
    if (label) label.textContent = adapter.mode === 'local' ? '浏览器演示模式' : '本地接口模式';
  }

  function setLoadingStats(isLoading) {
    ['statTotal', 'statMale', 'statFemale', 'statClasses'].forEach(function (id) {
      var element = byId(id);
      if (element && isLoading) element.textContent = '—';
    });
  }

  function renderStats(stats) {
    var safeStats = stats || {};
    var values = { statTotal: safeStats.total, statMale: safeStats.male, statFemale: safeStats.female, statClasses: safeStats.classes };
    Object.keys(values).forEach(function (id) {
      var element = byId(id);
      if (element) element.textContent = values[id] === null || values[id] === undefined ? '—' : formatNumber(values[id]);
    });
    var total = numberValue(safeStats.total);
    var hints = {
      statTotalHint: total ? '当前系统已收录' : '还没有学生档案',
      statMaleHint: total ? (Math.round(numberValue(safeStats.male) / total * 100) + '% 占比') : '等待添加',
      statFemaleHint: total ? (Math.round(numberValue(safeStats.female) / total * 100) + '% 占比') : '等待添加',
      statClassesHint: safeStats.classes ? '覆盖的教学班级' : '等待添加'
    };
    Object.keys(hints).forEach(function (id) { var element = byId(id); if (element) element.textContent = hints[id]; });
    var navCount = byId('navStudentCount');
    if (navCount && safeStats.total !== null && safeStats.total !== undefined) navCount.textContent = formatNumber(safeStats.total);
    var incomingClasses = Array.isArray(safeStats.classList) ? safeStats.classList : [];
    if (incomingClasses.length) updateClassOptions(incomingClasses);
  }

  function updateClassOptions(classes) {
    var allClasses = (classes || []).map(String).filter(Boolean).filter(function (value, index, array) { return array.indexOf(value) === index; }).sort();
    state.classes = allClasses;
    var select = byId('classFilter');
    if (!select) return;
    var current = state.className;
    select.innerHTML = '<option value="">全部班级</option>' + allClasses.map(function (name) { return '<option value="' + escapeHtml(name) + '">' + escapeHtml(name) + '</option>'; }).join('');
    select.value = current;
  }

  function renderRecent(students) {
    var container = byId('recentList');
    if (!container) return;
    if (!students || !students.length) {
      container.innerHTML = '<div class="empty-state"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 4h14v16H5zM8 8h8M8 12h8M8 16h5" /></svg><strong>还没有学生档案</strong><span>点击“添加学生”开始建立档案</span></div>';
      return;
    }
    container.innerHTML = students.slice(0, 6).map(function (student) {
      return '<div class="recent-row"><div class="student-avatar" aria-hidden="true">' + escapeHtml(firstCharacter(student.name)) + '</div><div class="student-row-copy"><strong>' + escapeHtml(student.name) + '</strong><span>' + escapeHtml(student.class_name || '未填写班级') + ' · ' + escapeHtml(student.student_id) + '</span></div><time datetime="' + escapeHtml(student.created_at || '') + '">' + escapeHtml(humanDate(student.created_at)) + '</time></div>';
    }).join('');
  }

  function setTableState(kind, title, description) {
    var stateElement = byId('tableState');
    if (!stateElement) return;
    var icon = kind === 'error' ? '<path d="M12 3 2.8 20h18.4L12 3ZM12 9v5M12 17h.01" />' : '<path d="M5 4h14v16H5zM8 8h8M8 12h8M8 16h5" />';
    if (kind === 'loading') icon = '<path d="M12 3a9 9 0 1 0 9 9" />';
    stateElement.innerHTML = '<div class="' + kind + '-state"><svg viewBox="0 0 24 24" aria-hidden="true">' + icon + '</svg><strong>' + escapeHtml(title) + '</strong><span>' + escapeHtml(description || '') + '</span></div>';
    stateElement.hidden = false;
  }

  function clearTableState() {
    var stateElement = byId('tableState');
    if (stateElement) { stateElement.hidden = true; stateElement.innerHTML = ''; }
  }

  function renderStudents() {
    var body = byId('studentsTableBody');
    if (!body) return;
    if (!state.students.length) {
      body.innerHTML = '';
      setTableState('empty', '没有匹配的学生', state.query || state.gender || state.className ? '试试修改搜索条件或筛选项' : '点击“添加学生”开始建立档案');
    } else {
      clearTableState();
      body.innerHTML = state.students.map(function (student) {
        var genderClass = student.gender === '男' ? 'gender-male' : (student.gender === '女' ? 'gender-female' : 'gender-other');
        var safeId = idValue(student.student_id);
        return '<tr><td><div class="student-cell"><div class="student-avatar" aria-hidden="true">' + escapeHtml(firstCharacter(student.name)) + '</div><div class="student-cell-copy"><strong>' + escapeHtml(student.name || '未命名') + '</strong><span>' + escapeHtml(student.student_id) + '</span></div></div></td><td>' + escapeHtml(student.student_id) + '</td><td><span class="gender-tag ' + genderClass + '">' + escapeHtml(student.gender || '未填写') + '</span></td><td>' + escapeHtml(student.age === '' || student.age === null ? '—' : student.age) + '</td><td><span class="class-tag">' + escapeHtml(student.class_name || '未填写') + '</span></td><td>' + escapeHtml(student.phone || '—') + '</td><td class="action-column"><div class="row-actions"><button class="row-action" type="button" data-action="view" data-id="' + escapeHtml(safeId) + '" aria-label="查看 ' + escapeHtml(student.name) + '"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M2.5 12s3.4-6 9.5-6 9.5 6 9.5 6-3.4 6-9.5 6-9.5-6-9.5-6Z"/><circle cx="12" cy="12" r="2.5"/></svg></button><button class="row-action" type="button" data-action="edit" data-id="' + escapeHtml(safeId) + '" aria-label="编辑 ' + escapeHtml(student.name) + '"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m4 16-.8 4.8L8 20l11.7-11.7a2.2 2.2 0 0 0-3-3L4 16Z"/><path d="m14.8 6.2 3 3"/></svg></button><button class="row-action action-delete" type="button" data-action="delete" data-id="' + escapeHtml(safeId) + '" aria-label="删除 ' + escapeHtml(student.name) + '"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M10 11v5M14 11v5M6.5 7l.7 13h9.6l.7-13M9 7V4h6v3"/></svg></button></div></td></tr>';
      }).join('');
    }
    renderSummary();
    renderPagination();
  }

  function renderSummary() {
    var summary = byId('resultSummary');
    if (!summary) return;
    if (state.total === 0) { summary.textContent = '共 0 条记录'; return; }
    var first = (state.page - 1) * state.pageSize + 1;
    var last = Math.min(state.page * state.pageSize, state.total);
    summary.textContent = '显示第 ' + first + '—' + last + ' 条，共 ' + formatNumber(state.total) + ' 条记录';
  }

  function pageNumbers(current, total) {
    if (total <= 5) return Array.from({ length: total }, function (_unused, index) { return index + 1; });
    var pages = [1];
    if (current > 3) pages.push('ellipsis-left');
    for (var page = Math.max(2, current - 1); page <= Math.min(total - 1, current + 1); page += 1) pages.push(page);
    if (current < total - 2) pages.push('ellipsis-right');
    pages.push(total);
    return pages;
  }

  function renderPagination() {
    var container = byId('pagination');
    if (!container) return;
    var total = Math.max(1, numberValue(state.totalPages, 1));
    var current = Math.min(Math.max(1, state.page), total);
    var html = '<button class="page-button" type="button" data-page="' + (current - 1) + '" aria-label="上一页"' + (current <= 1 ? ' disabled' : '') + '><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m14 6-6 6 6 6" /></svg></button>';
    html += pageNumbers(current, total).map(function (item) {
      if (typeof item === 'string') return '<span class="page-button page-ellipsis" aria-hidden="true">…</span>';
      return '<button class="page-button' + (item === current ? ' is-current' : '') + '" type="button" data-page="' + item + '" aria-label="第 ' + item + ' 页"' + (item === current ? ' aria-current="page"' : '') + '>' + item + '</button>';
    }).join('');
    html += '<button class="page-button" type="button" data-page="' + (current + 1) + '" aria-label="下一页"' + (current >= total ? ' disabled' : '') + '><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m10 6 6 6-6 6" /></svg></button>';
    container.innerHTML = html;
  }

  function setStudentsLoading(loading) {
    state.loadingStudents = loading;
    var body = byId('studentsTableBody');
    if (!body) return;
    if (loading) {
      body.innerHTML = '';
      setTableState('loading', '正在加载学生档案', '请稍候');
    }
  }

  function loadStudents(options) {
    var opts = options || {};
    if (opts.resetPage) state.page = 1;
    setStudentsLoading(true);
    return adapter.list({ q: state.query, gender: state.gender, class_name: state.className, page: state.page, page_size: state.pageSize }).then(function (result) {
      state.students = result.items || [];
      state.total = numberValue(result.total);
      state.page = numberValue(result.page, state.page);
      state.pageSize = numberValue(result.pageSize, PAGE_SIZE);
      state.totalPages = numberValue(result.totalPages, 1);
      if (result.classes && result.classes.length) updateClassOptions(result.classes);
      renderStudents();
      return result;
    }).catch(function (error) {
      state.students = [];
      state.total = 0;
      state.totalPages = 1;
      var body = byId('studentsTableBody');
      if (body) body.innerHTML = '';
      setTableState('error', '加载失败', errorMessage(error, '请检查本地服务是否已启动')); 
      renderSummary();
      renderPagination();
      throw error;
    }).finally(function () {
      state.loadingStudents = false;
    });
  }

  function loadDashboard() {
    setLoadingStats(true);
    var statsRequest = adapter.stats().then(function (stats) {
      state.stats = stats;
      renderStats(stats);
      return stats;
    });
    var listRequest = adapter.list({ page: 1, page_size: 6 }).then(function (result) {
      renderRecent(result.items);
      if (result.classes && result.classes.length) updateClassOptions(result.classes);
      return result;
    });
    return Promise.allSettled([statsRequest, listRequest]).then(function (results) {
      if (results[0].status === 'rejected' && results[1].status === 'rejected') showToast(errorMessage(results[0].reason, '仪表盘加载失败'), 'error');
      else if (results[0].status === 'rejected') showToast('统计数据加载失败：' + errorMessage(results[0].reason), 'error');
      else if (results[1].status === 'rejected') renderRecentError(results[1].reason);
    });
  }

  function renderRecentError(error) {
    var container = byId('recentList');
    if (!container) return;
    container.innerHTML = '<div class="error-state"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3 2.8 20h18.4L12 3ZM12 9v5M12 17h.01" /></svg><strong>最近添加加载失败</strong><span>' + escapeHtml(errorMessage(error)) + '</span></div>';
  }

  function applyFormErrors(errors) {
    queryAll('.form-field').forEach(function (field) { field.classList.remove('has-error'); });
    queryAll('.field-error').forEach(function (element) { element.textContent = ''; });
    Object.keys(errors || {}).forEach(function (fieldName) {
      var input = query('[name="' + fieldName + '"]');
      var field = input ? input.closest('.form-field') : null;
      var errorElement = query('[data-error-for="' + fieldName + '"]');
      if (field) field.classList.add('has-error');
      if (errorElement) errorElement.textContent = Array.isArray(errors[fieldName]) ? errors[fieldName][0] : String(errors[fieldName]);
    });
  }

  function clearFormErrors() {
    applyFormErrors({});
  }

  function openModal(modal) {
    if (!modal) return;
    lastFocusedElement = document.activeElement;
    activeModal = modal;
    byId('modalBackdrop').hidden = false;
    modal.hidden = false;
    document.body.classList.add('modal-open');
    var focusTarget = query('input:not([disabled]), select, button:not([disabled])', modal);
    if (focusTarget) window.setTimeout(function () { focusTarget.focus(); }, 0);
  }

  function closeActiveModal() {
    if (!activeModal) return;
    activeModal.hidden = true;
    activeModal = null;
    byId('modalBackdrop').hidden = true;
    document.body.classList.remove('modal-open');
    if (lastFocusedElement && typeof lastFocusedElement.focus === 'function') lastFocusedElement.focus();
    lastFocusedElement = null;
  }

  function formData() {
    var form = byId('studentForm');
    return { student_id: form.elements.student_id.value.trim(), name: form.elements.name.value.trim(), gender: form.elements.gender.value, age: form.elements.age.value.trim(), class_name: form.elements.class_name.value.trim(), phone: form.elements.phone.value.trim() };
  }

  function fillForm(student) {
    var form = byId('studentForm');
    var values = student || {};
    form.elements.student_id.value = values.student_id || '';
    form.elements.name.value = values.name || '';
    form.elements.gender.value = values.gender || '';
    form.elements.age.value = values.age === null || values.age === undefined ? '' : values.age;
    form.elements.class_name.value = values.class_name || '';
    form.elements.phone.value = values.phone || '';
  }

  function openStudentForm(student) {
    state.editingId = student ? String(student.student_id) : null;
    byId('studentModalTitle').textContent = student ? '编辑学生' : '添加学生';
    byId('studentModalEyebrow').textContent = student ? '档案维护' : '档案管理';
    byId('studentSubmit').textContent = student ? '保存修改' : '保存学生';
    fillForm(student);
    byId('studentIdInput').disabled = Boolean(student);
    clearFormErrors();
    openModal(byId('studentModal'));
  }

  function openDetail(student) {
    state.detailStudent = student;
    byId('detailAvatar').textContent = firstCharacter(student.name);
    byId('detailName').textContent = student.name || '未命名';
    byId('detailStudentId').textContent = student.student_id || '—';
    byId('detailGender').textContent = student.gender || '未填写';
    byId('detailAge').textContent = student.age === '' || student.age === null ? '未填写' : String(student.age) + ' 岁';
    byId('detailClass').textContent = student.class_name || '未填写';
    byId('detailPhone').textContent = student.phone || '未填写';
    openModal(byId('detailModal'));
  }

  function openConfirm(student) {
    state.deletingStudent = student;
    byId('confirmModalDescription').textContent = '“' + (student.name || student.student_id) + '”的档案删除后无法恢复，请确认是否继续。';
    openModal(byId('confirmModal'));
  }

  function findStudent(id) {
    return state.students.filter(function (student) { return String(student.student_id) === String(id); })[0] || null;
  }

  function showToast(message, type) {
    var region = byId('toastRegion');
    if (!region) return;
    var toast = document.createElement('div');
    toast.className = 'toast' + (type ? ' toast-' + type : '');
    var iconPath = type === 'error' ? '<path d="M12 3 2.8 20h18.4L12 3ZM12 9v5M12 17h.01" />' : (type === 'warning' ? '<path d="M12 3 2.8 20h18.4L12 3ZM12 9v5M12 17h.01" />' : '<path d="m5 12 4 4L19 6" />');
    toast.innerHTML = '<span class="toast-icon"><svg viewBox="0 0 24 24" aria-hidden="true">' + iconPath + '</svg></span><span>' + escapeHtml(message) + '</span>';
    region.appendChild(toast);
    var timer = window.setTimeout(function () {
      toast.classList.add('is-leaving');
      window.setTimeout(function () { if (toast.parentNode) toast.parentNode.removeChild(toast); }, 180);
    }, 4200);
    toastTimers.set(toast, timer);
  }

  function downloadBlob(blob, filename) {
    var url = URL.createObjectURL(blob);
    var link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
  }

  function dateFilename() {
    var date = new Date();
    var month = String(date.getMonth() + 1).padStart(2, '0');
    var day = String(date.getDate()).padStart(2, '0');
    return '学生档案-' + date.getFullYear() + month + day + '.csv';
  }

  function closeSidebar() {
    byId('sidebar').classList.remove('is-open');
    byId('sidebarBackdrop').classList.remove('is-visible');
    byId('menuToggle').setAttribute('aria-expanded', 'false');
  }

  function toggleSidebar() {
    var sidebar = byId('sidebar');
    var open = sidebar.classList.toggle('is-open');
    byId('sidebarBackdrop').classList.toggle('is-visible', open);
    byId('menuToggle').setAttribute('aria-expanded', String(open));
  }

  function switchView(view) {
    var allowed = ['dashboard', 'students', 'transfer', 'guide'];
    if (allowed.indexOf(view) === -1) view = 'dashboard';
    state.view = view;
    var labels = { dashboard: '仪表盘', students: '学生档案', transfer: '导入与导出', guide: '使用说明' };
    queryAll('[data-view-panel]').forEach(function (panel) {
      var isCurrent = panel.dataset.viewPanel === view;
      panel.hidden = !isCurrent;
      panel.classList.toggle('is-visible', isCurrent);
    });
    queryAll('.nav-item[data-view]').forEach(function (item) { item.classList.toggle('is-active', item.dataset.view === view); });
    byId('breadcrumbCurrent').textContent = labels[view];
    closeSidebar();
    if (view === 'dashboard') loadDashboard();
    if (view === 'students') {
      if (!state.students.length && !state.loadingStudents) loadStudents();
      else { renderStudents(); }
    }
  }

  function handleFormSubmit(event) {
    event.preventDefault();
    var values = formData();
    var clientErrors = validateStudent(values, state.editingId);
    applyFormErrors(clientErrors);
    if (Object.keys(clientErrors).length) {
      showToast('请先修正表单中的错误', 'warning');
      var firstError = query('.form-field.has-error input, .form-field.has-error select');
      if (firstError) firstError.focus();
      return;
    }
    var submit = byId('studentSubmit');
    submit.disabled = true;
    submit.classList.add('is-loading');
    var wasEditing = Boolean(state.editingId);
    var operation = wasEditing ? adapter.update(state.editingId, values) : adapter.create(values);
    operation.then(function () {
      closeActiveModal();
      showToast(wasEditing ? '学生档案已更新' : '学生档案已添加');
      state.editingId = null;
      if (state.view === 'students') return loadStudents({ resetPage: !wasEditing });
      return loadDashboard();
    }).catch(function (error) {
      if (error.details && typeof error.details === 'object') applyFormErrors(error.details);
      showToast(errorMessage(error, '保存失败'), 'error');
    }).finally(function () {
      submit.disabled = false;
      submit.classList.remove('is-loading');
    });
  }

  function handleImport(file) {
    if (!file) return;
    if (file.size > 10 * 1024 * 1024) { showToast('CSV 文件不能超过 10MB', 'warning'); return; }
    showToast('正在导入，请稍候');
    adapter.import(file).then(function (result) {
      showToast(result.message || ('成功导入 ' + result.imported + ' 条记录'));
      if (state.view === 'students') return loadStudents({ resetPage: true });
      return loadDashboard();
    }).catch(function (error) { showToast(errorMessage(error, '导入失败'), 'error'); }).finally(function () { byId('importFile').value = ''; });
  }

  function handleExport() {
    showToast('正在准备 CSV 文件，请稍候');
    adapter.export().then(function (blob) { downloadBlob(blob, dateFilename()); showToast('学生档案已导出'); }).catch(function (error) { showToast(errorMessage(error, '导出失败'), 'error'); });
  }

  function handleDelete() {
    var student = state.deletingStudent;
    if (!student) return;
    var button = byId('confirmDeleteButton');
    button.disabled = true;
    adapter.remove(student.student_id).then(function () {
      closeActiveModal();
      state.deletingStudent = null;
      showToast('学生档案已删除');
      if (state.view === 'students') return loadStudents({ resetPage: state.page > 1 && state.students.length === 1 });
      return loadDashboard();
    }).catch(function (error) { showToast(errorMessage(error, '删除失败'), 'error'); }).finally(function () { button.disabled = false; });
  }

  function bindEvents() {
    byId('todayLabel').textContent = todayText();
    queryAll('.nav-item[data-view]').forEach(function (item) { item.addEventListener('click', function () { switchView(item.dataset.view); }); });
    byId('menuToggle').addEventListener('click', toggleSidebar);
    byId('sidebarClose').addEventListener('click', closeSidebar);
    byId('sidebarBackdrop').addEventListener('click', closeSidebar);
    byId('modalBackdrop').addEventListener('click', closeActiveModal);
    byId('studentForm').addEventListener('submit', handleFormSubmit);
    byId('confirmDeleteButton').addEventListener('click', handleDelete);
    byId('detailEditButton').addEventListener('click', function () { var student = state.detailStudent; closeActiveModal(); if (student) openStudentForm(student); });
    byId('searchInput').addEventListener('input', function (event) {
      var value = event.target.value;
      byId('clearSearch').hidden = !value;
      window.clearTimeout(searchTimer);
      searchTimer = window.setTimeout(function () { state.query = value.trim(); loadStudents({ resetPage: true }).catch(function () {}); }, 240);
    });
    byId('clearSearch').addEventListener('click', function () { byId('searchInput').value = ''; byId('clearSearch').hidden = true; state.query = ''; loadStudents({ resetPage: true }).catch(function () {}); byId('searchInput').focus(); });
    byId('genderFilter').addEventListener('change', function (event) { state.gender = event.target.value; loadStudents({ resetPage: true }).catch(function () {}); });
    byId('classFilter').addEventListener('change', function (event) { state.className = event.target.value; loadStudents({ resetPage: true }).catch(function () {}); });
    byId('importFile').addEventListener('change', function (event) { handleImport(event.target.files && event.target.files[0]); });
    document.addEventListener('click', function (event) {
      var target = event.target.closest('[data-action]');
      if (!target) {
        var pageButton = event.target.closest('[data-page]');
        if (pageButton && !pageButton.disabled) { state.page = numberValue(pageButton.dataset.page, 1); loadStudents().catch(function () {}); }
        return;
      }
      var action = target.dataset.action;
      if (action === 'open-add') openStudentForm(null);
      else if (action === 'close-modal' || action === 'close-detail' || action === 'close-confirm') closeActiveModal();
      else if (action === 'show-students') switchView('students');
      else if (action === 'choose-import') byId('importFile').click();
      else if (action === 'export-csv') handleExport();
      else if (action === 'reset-demo') {
        if (adapter.mode !== 'local') { showToast('请在浏览器演示模式下使用此功能', 'warning'); return; }
        if (!window.confirm('恢复演示样例会覆盖当前浏览器中的演示数据，是否继续？')) return;
        adapter.resetDemo();
        showToast('演示样例已恢复');
        window.StudentApp.reload();
      }
      else if (action === 'view') { var viewed = findStudent(decodeId(target.dataset.id)); if (viewed) openDetail(viewed); else adapter.get(decodeId(target.dataset.id)).then(openDetail).catch(function (error) { showToast(errorMessage(error), 'error'); }); }
      else if (action === 'edit') { var edited = findStudent(decodeId(target.dataset.id)); if (edited) openStudentForm(edited); else adapter.get(decodeId(target.dataset.id)).then(openStudentForm).catch(function (error) { showToast(errorMessage(error), 'error'); }); }
      else if (action === 'delete') { var deleted = findStudent(decodeId(target.dataset.id)); if (deleted) openConfirm(deleted); else adapter.get(decodeId(target.dataset.id)).then(openConfirm).catch(function (error) { showToast(errorMessage(error), 'error'); }); }
    });
    document.addEventListener('keydown', function (event) {
      if (event.key === 'Escape') {
        if (activeModal) closeActiveModal();
        else closeSidebar();
      }
    });
  }

  function init() {
    setModeLabel();
    bindEvents();
    switchView('dashboard');
  }

  window.StudentApp = {
    setMode: function (mode) {
      var nextMode = mode === 'local' ? 'local' : 'api';
      MODE = nextMode;
      adapter = Adapters[nextMode];
      window.APP_MODE = nextMode;
      setModeLabel();
      state.page = 1;
      state.students = [];
      switchView(state.view);
    },
    reload: function () {
      return state.view === 'students' ? loadStudents() : loadDashboard();
    },
    resetDemoData: function () {
      if (adapter.mode !== 'local') return Promise.reject(new AppError('只有浏览器演示模式可以重置数据'));
      adapter.resetDemo();
      return window.StudentApp.reload();
    }
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
}());
