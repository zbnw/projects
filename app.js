/* ============================================================
   渲染逻辑 —— 一般不需要改这个文件
   读取 projects.js 里的 SITE / PROJECTS,渲染列表、处理搜索和标签筛选。
   ============================================================ */

(function () {
  "use strict";

  var state = {
    keyword: "",
    activeTag: null,
  };

  function escapeHtml(str) {
    var div = document.createElement("div");
    div.textContent = str == null ? "" : String(str);
    return div.innerHTML;
  }

  function isExternal(url) {
    return /^https?:\/\//i.test(url);
  }

  function getAllTags() {
    var set = [];
    PROJECTS.forEach(function (p) {
      (p.tags || []).forEach(function (t) {
        if (set.indexOf(t) === -1) set.push(t);
      });
    });
    return set;
  }

  function matches(project) {
    var kw = state.keyword.trim().toLowerCase();
    if (state.activeTag && (project.tags || []).indexOf(state.activeTag) === -1) {
      return false;
    }
    if (!kw) return true;
    var haystack = [project.name, project.desc]
      .concat(project.tags || [])
      .join(" ")
      .toLowerCase();
    return haystack.indexOf(kw) !== -1;
  }

  function renderMasthead() {
    document.getElementById("site-title").textContent = SITE.title || "项目";
    document.getElementById("site-subtitle").textContent = SITE.subtitle || "";
    document.title = SITE.title || "项目";
  }

  function renderMeta() {
    var dates = PROJECTS.map(function (p) { return p.date; }).filter(Boolean);
    dates.sort();
    var latest = dates.length ? dates[dates.length - 1] : null;
    var text = PROJECTS.length + " 个项目";
    if (latest) text += " · 最近更新 " + latest;
    document.getElementById("list-meta").textContent = text;
  }

  function renderTags() {
    var tagRow = document.getElementById("tag-row");
    var tags = getAllTags();
    if (!tags.length) {
      tagRow.style.display = "none";
      return;
    }
    var html = tags
      .map(function (t) {
        var active = state.activeTag === t ? " active" : "";
        return (
          '<button type="button" class="tag-chip' +
          active +
          '" data-tag="' +
          escapeHtml(t) +
          '">' +
          escapeHtml(t) +
          "</button>"
        );
      })
      .join("");
    tagRow.innerHTML = html;

    Array.prototype.forEach.call(tagRow.querySelectorAll(".tag-chip"), function (btn) {
      btn.addEventListener("click", function () {
        var tag = btn.getAttribute("data-tag");
        state.activeTag = state.activeTag === tag ? null : tag;
        renderTags();
        renderList();
      });
    });
  }

  function renderList() {
    var list = document.getElementById("project-list");
    var filtered = PROJECTS.filter(matches);

    if (!filtered.length) {
      list.innerHTML = '<li class="empty-state">没有找到匹配的项目</li>';
      return;
    }

    list.innerHTML = filtered
      .map(function (p, i) {
        var external = isExternal(p.url);
        var tagsHtml = (p.tags || [])
          .map(function (t) {
            return '<span class="tag">' + escapeHtml(t) + "</span>";
          })
          .join("");
        var label = p.name + (p.desc ? "," + p.desc : "");
        return (
          '<li class="row-item" style="animation-delay:' +
          Math.min(i * 30, 240) +
          'ms">' +
          '<a class="row" href="' +
          escapeHtml(p.url) +
          '" aria-label="' +
          escapeHtml(label) +
          '"' +
          (external ? ' target="_blank" rel="noopener noreferrer"' : "") +
          ">" +
          '<span class="col-name">' + escapeHtml(p.name) + "</span>" +
          '<span class="col-desc">' + escapeHtml(p.desc) + "</span>" +
          '<span class="col-tags">' + tagsHtml + "</span>" +
          '<span class="col-meta">' + escapeHtml(p.date || "") + "</span>" +
          "</a>" +
          "</li>"
        );
      })
      .join("");
  }

  function bindSearch() {
    var input = document.getElementById("search-input");
    input.addEventListener("input", function () {
      state.keyword = input.value;
      renderList();
    });
  }

  function init() {
    renderMasthead();
    renderMeta();
    renderTags();
    renderList();
    bindSearch();
    document.getElementById("year").textContent = new Date().getFullYear();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
