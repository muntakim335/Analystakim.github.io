/*
	Graphify — hand-rolled SVG dashboard, no chart library.
	Charts: monthly revenue line chart (2 series) + revenue-by-region columns.
	Stat tiles and data tables are computed from the same dataset so they
	always agree with the charts.
*/
(function () {
	'use strict';

	var data = {
		months: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'],
		rev2021: [12.1, 11.4, 13.0, 14.2, 15.8, 17.5, 18.9, 18.2, 16.4, 15.1, 16.8, 20.6],
		rev2022: [14.2, 13.6, 15.9, 17.4, 19.1, 21.3, 22.8, 21.9, 19.6, 18.4, 20.7, 25.2],
		unitsSold: 1284,
		regions: [
			{ name: 'London', value: 71.4 },
			{ name: 'South East', value: 43.8 },
			{ name: 'Midlands', value: 37.2 },
			{ name: 'North West', value: 32.6 },
			{ name: 'Scotland', value: 26.5 },
			{ name: 'Wales', value: 18.6 }
		]
	};

	var css = getComputedStyle(document.querySelector('.viz-root'));
	var color = {
		s1: css.getPropertyValue('--series-1').trim(),
		s2: css.getPropertyValue('--series-2').trim(),
		grid: css.getPropertyValue('--gridline').trim(),
		baseline: css.getPropertyValue('--baseline').trim(),
		muted: css.getPropertyValue('--text-muted').trim(),
		secondary: css.getPropertyValue('--text-secondary').trim(),
		primary: css.getPropertyValue('--text-primary').trim(),
		surface: css.getPropertyValue('--surface-1').trim()
	};

	var SVGNS = 'http://www.w3.org/2000/svg';

	function svgEl(name, attrs) {
		var el = document.createElementNS(SVGNS, name);
		for (var k in attrs) el.setAttribute(k, attrs[k]);
		return el;
	}

	function sum(arr) {
		return arr.reduce(function (a, b) { return a + b; }, 0);
	}

	function fmtK(v) {
		return '£' + v.toFixed(1) + 'K';
	}

	/* ---- Stat tiles ---- */

	function statTile(label, value, delta) {
		var tile = document.createElement('div');
		tile.className = 'stat-tile';
		var l = document.createElement('span');
		l.className = 'stat-label';
		l.textContent = label;
		var v = document.createElement('span');
		v.className = 'stat-value';
		v.textContent = value;
		tile.appendChild(l);
		tile.appendChild(v);
		if (delta) {
			var d = document.createElement('span');
			d.className = 'stat-delta';
			d.textContent = delta;
			tile.appendChild(d);
		}
		return tile;
	}

	function renderStats() {
		var row = document.getElementById('stat-row');
		var total22 = sum(data.rev2022);
		var total21 = sum(data.rev2021);
		var yoy = (total22 - total21) / total21 * 100;
		var aov = total22 * 1000 / data.unitsSold;
		row.appendChild(statTile('Total revenue 2022', fmtK(total22), '+' + yoy.toFixed(1) + '% vs 2021'));
		row.appendChild(statTile('Units sold', data.unitsSold.toLocaleString('en-GB')));
		row.appendChild(statTile('Avg order value', '£' + Math.round(aov)));
		row.appendChild(statTile('Best month', 'Dec · ' + fmtK(Math.max.apply(null, data.rev2022))));
	}

	/* ---- Shared tooltip ---- */

	function makeTooltip(wrap) {
		var tt = document.createElement('div');
		tt.className = 'viz-tooltip';
		wrap.appendChild(tt);
		return tt;
	}

	function ttRow(tt, value, series, keyColor) {
		var row = document.createElement('div');
		row.className = 'tt-row';
		if (keyColor) {
			var key = document.createElement('span');
			key.className = 'tt-key';
			key.style.borderTopColor = keyColor;
			row.appendChild(key);
		}
		var val = document.createElement('span');
		val.className = 'tt-value';
		val.textContent = value;
		row.appendChild(val);
		if (series) {
			var s = document.createElement('span');
			s.className = 'tt-series';
			s.textContent = series;
			row.appendChild(s);
		}
		tt.appendChild(row);
	}

	function placeTooltip(tt, wrap, pxX, pxY) {
		tt.style.display = 'block';
		var w = tt.offsetWidth;
		var left = pxX + 14;
		if (left + w > wrap.clientWidth) left = pxX - w - 14;
		tt.style.left = left + 'px';
		tt.style.top = Math.max(0, pxY - tt.offsetHeight - 10) + 'px';
	}

	/* ---- Data table views ---- */

	function buildTable(container, headers, rows) {
		var wrapper = document.createElement('div');
		wrapper.style.overflowX = 'auto';
		var table = document.createElement('table');
		var thead = document.createElement('thead');
		var tr = document.createElement('tr');
		headers.forEach(function (h) {
			var th = document.createElement('th');
			th.textContent = h;
			tr.appendChild(th);
		});
		thead.appendChild(tr);
		table.appendChild(thead);
		var tbody = document.createElement('tbody');
		rows.forEach(function (r) {
			var trb = document.createElement('tr');
			r.forEach(function (c) {
				var td = document.createElement('td');
				td.textContent = c;
				trb.appendChild(td);
			});
			tbody.appendChild(trb);
		});
		table.appendChild(tbody);
		wrapper.appendChild(table);
		container.appendChild(wrapper);
	}

	/* ---- Line chart: monthly revenue, 2021 vs 2022 ---- */

	function renderLineChart() {
		var W = 760, H = 300;
		var m = { top: 16, right: 64, bottom: 30, left: 40 };
		var plotW = W - m.left - m.right;
		var plotH = H - m.top - m.bottom;
		var yMax = 30;

		var series = [
			{ name: '2022', values: data.rev2022, color: color.s1 },
			{ name: '2021', values: data.rev2021, color: color.s2 }
		];

		var wrap = document.getElementById('line-chart');
		var svg = svgEl('svg', {
			viewBox: '0 0 ' + W + ' ' + H,
			role: 'img',
			tabindex: '0',
			'aria-label': 'Line chart of monthly bike sales revenue for 2021 and 2022 in thousands of pounds. Use left and right arrow keys to read values per month; full values are in the data table below.'
		});

		function x(i) { return m.left + plotW * i / (data.months.length - 1); }
		function y(v) { return m.top + plotH * (1 - v / yMax); }

		// gridlines + y ticks
		[0, 10, 20, 30].forEach(function (t) {
			svg.appendChild(svgEl('line', {
				x1: m.left, x2: m.left + plotW, y1: y(t), y2: y(t),
				stroke: t === 0 ? color.baseline : color.grid, 'stroke-width': 1
			}));
			var lbl = svgEl('text', {
				x: m.left - 8, y: y(t) + 4, 'text-anchor': 'end',
				fill: color.muted, 'font-size': '12', style: 'font-variant-numeric: tabular-nums'
			});
			lbl.textContent = String(t);
			svg.appendChild(lbl);
		});

		// x labels
		data.months.forEach(function (mo, i) {
			var lbl = svgEl('text', {
				x: x(i), y: H - 8, 'text-anchor': 'middle',
				fill: color.muted, 'font-size': '12'
			});
			lbl.textContent = mo;
			svg.appendChild(lbl);
		});

		// series lines, end dots (2px surface ring), direct end labels
		series.forEach(function (s) {
			var d = s.values.map(function (v, i) {
				return (i ? 'L' : 'M') + x(i).toFixed(1) + ' ' + y(v).toFixed(1);
			}).join(' ');
			svg.appendChild(svgEl('path', {
				d: d, fill: 'none', stroke: s.color, 'stroke-width': 2,
				'stroke-linecap': 'round', 'stroke-linejoin': 'round'
			}));
			var last = s.values.length - 1;
			svg.appendChild(svgEl('circle', {
				cx: x(last), cy: y(s.values[last]), r: 4,
				fill: s.color, stroke: color.surface, 'stroke-width': 2
			}));
			var end = svgEl('text', {
				x: x(last) + 10, y: y(s.values[last]) + 4,
				fill: color.secondary, 'font-size': '12', 'font-weight': '600'
			});
			end.textContent = s.name;
			svg.appendChild(end);
		});

		// hover layer: crosshair + markers + tooltip
		var crosshair = svgEl('line', {
			y1: m.top, y2: m.top + plotH, stroke: color.baseline,
			'stroke-width': 1, visibility: 'hidden'
		});
		svg.appendChild(crosshair);
		var hoverDots = series.map(function (s) {
			var c = svgEl('circle', {
				r: 4, fill: s.color, stroke: color.surface,
				'stroke-width': 2, visibility: 'hidden'
			});
			svg.appendChild(c);
			return c;
		});

		var tt = makeTooltip(wrap);

		function showIndex(i) {
			var xi = x(i);
			crosshair.setAttribute('x1', xi);
			crosshair.setAttribute('x2', xi);
			crosshair.setAttribute('visibility', 'visible');
			tt.textContent = '';
			var title = document.createElement('span');
			title.className = 'tt-title';
			title.textContent = data.months[i] + ' revenue';
			tt.appendChild(title);
			series.forEach(function (s, si) {
				hoverDots[si].setAttribute('cx', xi);
				hoverDots[si].setAttribute('cy', y(s.values[i]));
				hoverDots[si].setAttribute('visibility', 'visible');
				ttRow(tt, fmtK(s.values[i]), s.name, s.color);
			});
			var scale = wrap.clientWidth / W;
			placeTooltip(tt, wrap, xi * scale, y(Math.max(series[0].values[i], series[1].values[i])) * scale);
		}

		function hide() {
			crosshair.setAttribute('visibility', 'hidden');
			hoverDots.forEach(function (c) { c.setAttribute('visibility', 'hidden'); });
			tt.style.display = 'none';
			focusIndex = -1;
		}

		svg.addEventListener('pointermove', function (ev) {
			var rect = svg.getBoundingClientRect();
			var vx = (ev.clientX - rect.left) / rect.width * W;
			var i = Math.round((vx - m.left) / plotW * (data.months.length - 1));
			if (i < 0 || i > data.months.length - 1) { hide(); return; }
			showIndex(i);
		});
		svg.addEventListener('pointerleave', hide);

		var focusIndex = -1;
		svg.addEventListener('keydown', function (ev) {
			if (ev.key === 'ArrowRight' || ev.key === 'ArrowLeft') {
				ev.preventDefault();
				var step = ev.key === 'ArrowRight' ? 1 : -1;
				focusIndex = focusIndex < 0 ? (step > 0 ? 0 : data.months.length - 1)
					: Math.min(data.months.length - 1, Math.max(0, focusIndex + step));
				showIndex(focusIndex);
			} else if (ev.key === 'Escape') {
				hide();
			}
		});
		svg.addEventListener('blur', hide);

		wrap.appendChild(svg);

		// legend (2 series → always present; line keys mirror the mark)
		var legend = document.getElementById('line-legend');
		series.forEach(function (s) {
			var item = document.createElement('span');
			var key = document.createElement('span');
			key.className = 'key';
			key.style.borderTopColor = s.color;
			item.appendChild(key);
			item.appendChild(document.createTextNode(s.name));
			legend.appendChild(item);
		});

		buildTable(
			document.getElementById('line-table'),
			['Month', '2021 (£K)', '2022 (£K)'],
			data.months.map(function (mo, i) {
				return [mo, data.rev2021[i].toFixed(1), data.rev2022[i].toFixed(1)];
			})
		);
	}

	/* ---- Column chart: revenue by region ---- */

	function renderBarChart() {
		var W = 760, H = 300;
		var m = { top: 20, right: 16, bottom: 30, left: 40 };
		var plotW = W - m.left - m.right;
		var plotH = H - m.top - m.bottom;
		var yMax = 80;
		var barW = 24; // spec: columns capped at 24px

		var wrap = document.getElementById('bar-chart');
		var svg = svgEl('svg', {
			viewBox: '0 0 ' + W + ' ' + H,
			role: 'img',
			'aria-label': 'Column chart of 2022 bike sales revenue by UK region in thousands of pounds. Full values are in the data table below.'
		});

		function bandX(i) { return m.left + plotW * (i + 0.5) / data.regions.length; }
		function y(v) { return m.top + plotH * (1 - v / yMax); }

		[0, 20, 40, 60, 80].forEach(function (t) {
			svg.appendChild(svgEl('line', {
				x1: m.left, x2: m.left + plotW, y1: y(t), y2: y(t),
				stroke: t === 0 ? color.baseline : color.grid, 'stroke-width': 1
			}));
			var lbl = svgEl('text', {
				x: m.left - 8, y: y(t) + 4, 'text-anchor': 'end',
				fill: color.muted, 'font-size': '12', style: 'font-variant-numeric: tabular-nums'
			});
			lbl.textContent = String(t);
			svg.appendChild(lbl);
		});

		var tt = makeTooltip(wrap);
		var maxVal = Math.max.apply(null, data.regions.map(function (r) { return r.value; }));

		data.regions.forEach(function (r, i) {
			var cx = bandX(i);
			var top = y(r.value);
			var base = y(0);
			var h = base - top;
			var radius = Math.min(4, h);
			// rounded 4px data-end at the top, square at the baseline
			var bar = svgEl('path', {
				d: 'M' + (cx - barW / 2) + ' ' + base +
					' V' + (top + radius) +
					' Q' + (cx - barW / 2) + ' ' + top + ' ' + (cx - barW / 2 + radius) + ' ' + top +
					' H' + (cx + barW / 2 - radius) +
					' Q' + (cx + barW / 2) + ' ' + top + ' ' + (cx + barW / 2) + ' ' + (top + radius) +
					' V' + base + ' Z',
				fill: color.s1
			});
			svg.appendChild(bar);

			// x label
			var lbl = svgEl('text', {
				x: cx, y: H - 8, 'text-anchor': 'middle',
				fill: color.muted, 'font-size': '12'
			});
			lbl.textContent = r.name;
			svg.appendChild(lbl);

			// selective direct label: the extreme only; the rest live in ticks/tooltip/table
			if (r.value === maxVal) {
				var cap = svgEl('text', {
					x: cx, y: top - 8, 'text-anchor': 'middle',
					fill: color.secondary, 'font-size': '12', 'font-weight': '600'
				});
				cap.textContent = fmtK(r.value);
				svg.appendChild(cap);
			}

			// full-height transparent hit target, wider than the mark
			var hit = svgEl('rect', {
				x: cx - plotW / data.regions.length / 2, y: m.top,
				width: plotW / data.regions.length, height: plotH,
				fill: 'transparent'
			});
			hit.addEventListener('pointermove', function () {
				bar.setAttribute('opacity', '0.8');
				tt.textContent = '';
				var title = document.createElement('span');
				title.className = 'tt-title';
				title.textContent = r.name;
				tt.appendChild(title);
				ttRow(tt, fmtK(r.value), 'revenue', null);
				var scale = wrap.clientWidth / W;
				placeTooltip(tt, wrap, cx * scale, top * scale);
			});
			hit.addEventListener('pointerleave', function () {
				bar.removeAttribute('opacity');
				tt.style.display = 'none';
			});
			svg.appendChild(hit);
		});

		wrap.appendChild(svg);

		buildTable(
			document.getElementById('bar-table'),
			['Region', 'Revenue (£K)'],
			data.regions.map(function (r) { return [r.name, r.value.toFixed(1)]; })
		);
	}

	renderStats();
	renderLineChart();
	renderBarChart();
})();
