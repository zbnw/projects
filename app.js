/* ============================================================
   项目列表渲染
   - 数据来自 projects.js 中的 SITE / PROJECTS
   - 支持关键词搜索、标签筛选、快捷键与无结果恢复
   ============================================================ */

(function () {
  "use strict";

  var state = { keyword: "", activeTag: null };
  var searchInput;
  var clearButton;

  function escapeHtml(value) {
    var div = document.createElement("div");
    div.textContent = value == null ? "" : String(value);
    return div.innerHTML;
  }

  function isExternal(url) {
    return /^https?:\/\//i.test(url);
  }

  function getAllTags() {
    var tags = [];
    PROJECTS.forEach(function (project) {
      (project.tags || []).forEach(function (tag) {
        if (tags.indexOf(tag) === -1) tags.push(tag);
      });
    });
    return tags;
  }

  function getLatestDate() {
    var dates = PROJECTS.map(function (project) { return project.date; }).filter(Boolean).sort();
    return dates.length ? dates[dates.length - 1] : "—";
  }

  function matches(project) {
    var keyword = state.keyword.trim().toLowerCase();
    if (state.activeTag && (project.tags || []).indexOf(state.activeTag) === -1) return false;
    if (!keyword) return true;
    return [project.name, project.desc].concat(project.tags || []).join(" ").toLowerCase().indexOf(keyword) !== -1;
  }

  function renderHeader() {
    var tags = getAllTags();
    document.getElementById("site-title").textContent = SITE.title || "项目集";
    document.getElementById("site-subtitle").textContent = SITE.subtitle || "";
    document.getElementById("project-count").textContent = String(PROJECTS.length).padStart(2, "0");
    document.getElementById("tag-count").textContent = String(tags.length).padStart(2, "0");
    document.getElementById("latest-date").textContent = getLatestDate();
    document.title = (SITE.title || "项目集") + " · Projects";
  }

  function renderTags() {
    var tagRow = document.getElementById("tag-row");
    var tags = [null].concat(getAllTags());
    tagRow.innerHTML = tags.map(function (tag) {
      var active = state.activeTag === tag;
      var label = tag || "全部";
      return '<button type="button" class="tag-chip' + (active ? " active" : "") + '" data-tag="' + escapeHtml(tag || "") + '" aria-pressed="' + active + '">' + escapeHtml(label) + "</button>";
    }).join("");

    Array.prototype.forEach.call(tagRow.querySelectorAll(".tag-chip"), function (button) {
      button.addEventListener("click", function () {
        state.activeTag = button.getAttribute("data-tag") || null;
        renderTags();
        renderList();
      });
    });
  }

  function renderList() {
    var list = document.getElementById("project-list");
    var filtered = PROJECTS.filter(matches);
    document.getElementById("result-meta").textContent = "SHOWING " + filtered.length + " / " + PROJECTS.length;

    if (!filtered.length) {
      list.innerHTML = '<li class="empty-state"><div><strong>没有找到匹配的项目</strong><span>换个关键词，或者清除当前筛选。</span><button type="button" id="reset-filter">清除筛选</button></div></li>';
      document.getElementById("reset-filter").addEventListener("click", resetFilters);
      return;
    }

    list.innerHTML = filtered.map(function (project, index) {
      var tags = (project.tags || []).map(function (tag) {
        return '<span class="card-tag">' + escapeHtml(tag) + "</span>";
      }).join("");
      var external = isExternal(project.url);
      var label = project.name + (project.desc ? "，" + project.desc : "");
      return (
        '<li class="project-card" style="--delay:' + Math.min(index * 55, 275) + 'ms">' +
          '<a href="' + escapeHtml(project.url) + '" aria-label="' + escapeHtml(label) + '"' + (external ? ' target="_blank" rel="noopener noreferrer"' : "") + ">" +
            '<div class="card-top"><span class="card-index">PROJECT / ' + String(index + 1).padStart(2, "0") + '</span><span class="card-date">' + escapeHtml(project.date || "ONGOING") + "</span></div>" +
            "<h3>" + escapeHtml(project.name) + "</h3>" +
            '<p class="card-desc">' + escapeHtml(project.desc || "暂无简介") + "</p>" +
            '<div class="card-bottom"><div class="card-tags">' + tags + '</div><span class="card-arrow" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M7 17 17 7M8 7h9v9"/></svg></span></div>' +
          "</a>" +
        "</li>"
      );
    }).join("");
  }

  function updateSearch() {
    state.keyword = searchInput.value;
    clearButton.hidden = !state.keyword;
    renderList();
  }

  function resetFilters() {
    state.keyword = "";
    state.activeTag = null;
    searchInput.value = "";
    clearButton.hidden = true;
    renderTags();
    renderList();
    searchInput.focus();
  }

  function bindControls() {
    searchInput = document.getElementById("search-input");
    clearButton = document.getElementById("clear-search");
    searchInput.addEventListener("input", updateSearch);
    clearButton.addEventListener("click", resetFilters);
    document.addEventListener("keydown", function (event) {
      if (event.key === "/" && document.activeElement !== searchInput) {
        event.preventDefault();
        searchInput.focus();
      }
      if (event.key === "Escape" && document.activeElement === searchInput && searchInput.value) resetFilters();
    });
  }

  function init() {
    bindControls();
    renderHeader();
    renderTags();
    renderList();
    document.getElementById("year").textContent = new Date().getFullYear();
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
