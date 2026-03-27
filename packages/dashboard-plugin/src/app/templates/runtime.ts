/**
 * JavaScript runtime for generated dashboard apps.
 *
 * Handles: chart registry, window resize, theme toggle, export helpers,
 * cross-filtering, chart type switching, table search/pagination.
 */

export function buildRuntimeScript(): string {
  return `
(function(){
  // Chart and widget registries (populated by widget scripts)
  window.__charts = window.__charts || {};
  window.__widgets = window.__widgets || {};

  // --- Resize handler ---
  var resizeTimeout;
  window.addEventListener('resize', function() {
    clearTimeout(resizeTimeout);
    resizeTimeout = setTimeout(function() {
      for (var id in window.__charts) {
        if (window.__charts[id] && window.__charts[id].resize) {
          window.__charts[id].resize();
        }
      }
    }, 150);
  });

  // --- Theme toggle ---
  window.__toggleTheme = function() {
    var html = document.documentElement;
    var current = html.dataset.theme || 'light';
    var next = current === 'dark' ? 'light' : 'dark';
    html.dataset.theme = next;

    var icon = document.getElementById('theme-icon');
    if (icon) icon.innerHTML = next === 'dark' ? '&#9788;' : '&#9789;';

    for (var id in window.__charts) {
      var chart = window.__charts[id];
      if (!chart) continue;
      var el = chart.getDom();
      var option = chart.getOption();
      chart.dispose();
      var newChart = echarts.init(el, next === 'dark' ? 'dark' : null);
      newChart.setOption(option);
      window.__charts[id] = newChart;
      if (window.__widgets[id] && window.__widgets[id].chart) {
        window.__widgets[id].chart = newChart;
      }
    }
  };

  // --- Auto theme detection ---
  if (document.documentElement.dataset.theme === 'auto') {
    var prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    document.documentElement.dataset.theme = prefersDark ? 'dark' : 'light';
  }

  // === Cross-filtering engine ===
  window.__filterState = {};

  window.__applyFilter = function(field, value) {
    if (value === null || value === undefined || value === '') {
      delete window.__filterState[field];
    } else {
      window.__filterState[field] = value;
    }
    window.__updateFilteredWidgets();
  };

  window.__clearFilters = function() {
    window.__filterState = {};
    window.__updateFilteredWidgets();
    // Reset filter controls
    var selects = document.querySelectorAll('[data-filter-field]');
    for (var i = 0; i < selects.length; i++) selects[i].value = '';
    var dateInputs = document.querySelectorAll('[data-date-filter]');
    for (var j = 0; j < dateInputs.length; j++) dateInputs[j].value = '';
  };

  window.__updateFilteredWidgets = function() {
    for (var id in window.__widgets) {
      var widget = window.__widgets[id];
      if (!widget.originalData) continue;

      var filtered = widget.originalData;
      for (var field in window.__filterState) {
        var filterVal = window.__filterState[field];
        filtered = filtered.filter(function(row) {
          if (row[field] === undefined) return true;
          return String(row[field]) === String(filterVal);
        });
      }

      if (widget.chart) {
        widget.chart.setOption({ dataset: { source: filtered } });
        widget.data = filtered;
      } else if (widget.type === 'table') {
        widget.data = filtered;
        window.__renderTablePage(id, 0);
      }
    }
  };

  // === Chart type switching ===
  window.__switchChartType = function(widgetId) {
    var widget = window.__widgets[widgetId];
    if (!widget || !widget.chart) return;
    var types = ['bar', 'line'];
    var option = widget.chart.getOption();
    if (!option.series || !option.series.length) return;
    var current = option.series[0].type;
    var idx = types.indexOf(current);
    var next = types[(idx + 1) % types.length];
    var newSeries = option.series.map(function(s) {
      var copy = {};
      for (var k in s) copy[k] = s[k];
      copy.type = next;
      if (next === 'line') { delete copy.areaStyle; }
      return copy;
    });
    widget.chart.setOption({ series: newSeries }, false);
    // Update button label
    var btn = document.getElementById('switch-' + widgetId);
    if (btn) btn.textContent = next === 'bar' ? '\\u2587' : '\\u2571';
  };

  // === Export helpers ===
  window.__exportChart = function(widgetId, format) {
    var chart = window.__charts[widgetId];
    if (!chart) return;
    if (format === 'png') {
      var bg = document.documentElement.dataset.theme === 'dark' ? '#1e293b' : '#fff';
      var url = chart.getDataURL({ type: 'png', pixelRatio: 2, backgroundColor: bg });
      window.__downloadFile(url, widgetId + '.png');
    }
  };

  window.__exportTableCsv = function(widgetId) {
    var widget = window.__widgets[widgetId];
    if (!widget || !widget.data || !widget.columns) return;
    var header = widget.columns.map(function(c) { return c.label || c.key; }).join(',');
    var rows = widget.data.map(function(row) {
      return widget.columns.map(function(c) {
        var val = row[c.key];
        if (val == null) return '';
        var str = String(val);
        if (str.indexOf(',') >= 0 || str.indexOf('"') >= 0 || str.indexOf('\\n') >= 0) {
          return '"' + str.replace(/"/g, '""') + '"';
        }
        return str;
      }).join(',');
    });
    var csv = header + '\\n' + rows.join('\\n');
    var blob = new Blob([csv], { type: 'text/csv' });
    window.__downloadFile(URL.createObjectURL(blob), widgetId + '.csv');
  };

  window.__exportAll = function() {
    for (var id in window.__charts) {
      window.__exportChart(id, 'png');
    }
  };

  window.__downloadFile = function(url, filename) {
    var a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
  };

  // === Table sort / search / pagination ===
  window.__sortTable = function(widgetId, columnKey) {
    var widget = window.__widgets[widgetId];
    if (!widget || widget.type !== 'table') return;
    var dir = (widget.sortColumn === columnKey) ? -widget.sortDirection : 1;
    widget.sortColumn = columnKey;
    widget.sortDirection = dir;
    widget.data.sort(function(a, b) {
      var va = a[columnKey], vb = b[columnKey];
      if (va < vb) return -dir;
      if (va > vb) return dir;
      return 0;
    });
    window.__renderTablePage(widgetId, 0);
  };

  window.__searchTable = function(widgetId, query) {
    var widget = window.__widgets[widgetId];
    if (!widget || widget.type !== 'table') return;
    var q = query.toLowerCase();
    widget.data = q
      ? widget.originalData.filter(function(row) {
          return Object.values(row).some(function(v) {
            return String(v).toLowerCase().indexOf(q) >= 0;
          });
        })
      : widget.originalData.slice();
    widget.currentPage = 0;
    window.__renderTablePage(widgetId, 0);
  };

  window.__goToPage = function(widgetId, page) {
    window.__renderTablePage(widgetId, page);
  };

  window.__renderTablePage = function(widgetId, page) {
    var widget = window.__widgets[widgetId];
    if (!widget) return;
    var ps = widget.pageSize || widget.data.length;
    widget.currentPage = page;
    var start = page * ps;
    var rows = widget.data.slice(start, start + ps);
    var tbody = document.getElementById('tbody-' + widgetId);
    if (tbody) {
      tbody.innerHTML = rows.map(function(row) {
        return '<tr>' + widget.columns.map(function(c) {
          var v = row[c.key];
          return '<td>' + (v != null ? String(v).replace(/</g,'&lt;') : '') + '</td>';
        }).join('') + '</tr>';
      }).join('');
    }
    // Update pagination
    var footer = document.getElementById('footer-' + widgetId);
    if (footer) {
      var total = widget.data.length;
      var pages = Math.ceil(total / ps);
      var showing = 'Showing ' + (start + 1) + '-' + Math.min(start + ps, total) + ' of ' + total;
      var btns = '';
      for (var i = 0; i < Math.min(pages, 10); i++) {
        btns += '<button class="' + (i === page ? 'active' : '') + '" onclick="window.__goToPage(\\'' + widgetId + '\\',' + i + ')">' + (i + 1) + '</button>';
      }
      footer.innerHTML = '<span>' + showing + '</span><div class="table-pagination">' + btns + '</div>';
    }
  };

  // === Date range filter ===
  window.__applyDateRange = function(field) {
    var from = document.getElementById('date-from-' + field);
    var to = document.getElementById('date-to-' + field);
    if (!from || !to) return;
    var fromVal = from.value;
    var toVal = to.value;
    // Remove existing date filters and apply new
    for (var id in window.__widgets) {
      var widget = window.__widgets[id];
      if (!widget.originalData) continue;
      var filtered = widget.originalData;
      // Apply non-date filters first
      for (var f in window.__filterState) {
        filtered = filtered.filter(function(row) {
          if (row[f] === undefined) return true;
          return String(row[f]) === String(window.__filterState[f]);
        });
      }
      // Apply date filter
      if (fromVal || toVal) {
        filtered = filtered.filter(function(row) {
          var dateVal = row[field];
          if (!dateVal) return true;
          var d = String(dateVal);
          if (fromVal && d < fromVal) return false;
          if (toVal && d > toVal) return false;
          return true;
        });
      }
      if (widget.chart) {
        widget.chart.setOption({ dataset: { source: filtered } });
        widget.data = filtered;
      } else if (widget.type === 'table') {
        widget.data = filtered;
        window.__renderTablePage(id, 0);
      }
    }
  };

  // --- PostMessage handler for patches ---
  window.addEventListener('message', function(event) {
    if (!event.data || event.data.type !== 'nexora-patch') return;
    var patch = event.data.patch;
    if (patch.type === 'theme-change') {
      window.__toggleTheme();
    }
  });
})();
`;
}
