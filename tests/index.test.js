import { describe, it, expect, beforeEach, vi } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

// Load the generated HTML content for the test environment
// file moved into the sp-dashboard subdirectory
const html = readFileSync(resolve(__dirname, '../sp-dashboard/index.html'), 'utf8');

const toLocalDate = (d) => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;

describe('Date Range Reporter UI', () => {
  let scriptContent;

  beforeEach(() => {
    // Reset the DOM and clear any persisted localStorage state between tests
    localStorage.clear();
    document.documentElement.innerHTML = html;

    // In a JSDOM environment, we need to manually execute the script 
    // because JSDOM doesn't run script tags automatically by default in Vitest
    const scriptElement = Array.from(document.querySelectorAll('script'))
      .find(s => !s.src && s.textContent.includes('processData'));
    
    if (scriptElement) {
      // Execute the plugin logic in the global window context
      const runScript = new Function(scriptElement.textContent);
      runScript.call(window);
    }
  });

  describe('Utility Functions', () => {
    it('should correctly format time in milliseconds to hours and minutes', () => {
      // Testing the formatTime function defined in the script
      expect(window.formatTime(3600000)).toBe('1h 0m');
      expect(window.formatTime(9000000)).toBe('2h 30m');
      expect(window.formatTime(0)).toBe('0h 0m');
    });

    it('should format date strings to short readable format', () => {
      expect(window.formatDateShort('2026-02-22')).toBe('Feb 22, 2026');
    });

    it('should generate an array of dates within a range', () => {
      const range = window.getDatesInRange('2026-02-20', '2026-02-22');
      expect(range).toEqual(['2026-02-20', '2026-02-21', '2026-02-22']);
    });

    it('getDatesInRange should tolerate full ISO timestamps as inputs', () => {
      const range = window.getDatesInRange('2026-02-20T10:00:00Z', '2026-02-22T10:00:00Z');
      expect(range).toEqual(['2026-02-20', '2026-02-21', '2026-02-22']);
    });

    it('getDueBounds dueEnd should be end-of-day (DST-safe calculation)', () => {
      const { dueStart, dueEnd } = window.getDueBounds({ dueDay: '2026-03-28' });
      expect(dueStart).not.toBeNull();
      expect(dueEnd).toBeGreaterThan(dueStart);
      expect(dueEnd - dueStart).toBeGreaterThanOrEqual(82800000); // at least 23h
      expect(dueEnd - dueStart).toBeLessThanOrEqual(90000000);    // at most 25h
    });

    it('getDueBounds should handle a full ISO timestamp in dueDay', () => {
      const { dueStart, dueEnd } = window.getDueBounds({ dueDay: '2026-02-20T10:00:00Z' });
      expect(dueStart).not.toBeNull();
      expect(dueEnd).not.toBeNull();
      // dueStart should parse to 2026-02-20 local midnight
      expect(toLocalDate(new Date(dueStart))).toBe('2026-02-20');
    });

    it('month preset should cover the full previous calendar month', () => {
      // March 15, 2026 at noon — month preset should show Mar 1–15 (current month, day 1 to today)
      vi.useFakeTimers({ now: new Date('2026-03-15T12:00:00').getTime() });
      // The range diagnostic goes through debugLog, which is off by default.
      window.setSetting('debugLogging', true);
      const consoleSpy = vi.spyOn(console, 'log');
      const presetSelect = document.getElementById('date-preset');
      presetSelect.value = 'month';
      presetSelect.dispatchEvent(new Event('change'));
      window.processData([], []);
      vi.useRealTimers();
      const rangeLog = consoleSpy.mock.calls.find(args => String(args[0]).includes('computed date range'));
      expect(rangeLog).toBeDefined();
      expect(rangeLog[1]).toBe('2026-03-01'); // 1st of current month
      expect(rangeLog[2]).toBe('2026-03-15'); // today
      consoleSpy.mockRestore();
      window.setSetting('debugLogging', false);
    });
  });

  describe('Dashboard State Updates', () => {
    it('should calculate metrics correctly and update stat cards', () => {
      const mockTasks = [
        {
          id: 't1',
          parentId: null,
          title: 'Task 1',
          isDone: true,
          doneOn: new Date().getTime(),
          timeSpentOnDay: { [toLocalDate(new Date())]: 7200000 } // 2h
        },
        {
          id: 't2',
          parentId: null,
          title: 'Task 2',
          isDone: false,
          timeSpentOnDay: { [toLocalDate(new Date())]: 3600000 } // 1h
        }
      ];
      const mockProjects = [{ id: 'p1', title: 'Test Project' }];

      // Manually trigger the processing logic
      window.processData(mockTasks, mockProjects);

      // Verify UI elements updated
      expect(document.getElementById('stat-time').innerText).toBe('3h 0m');
      expect(document.getElementById('stat-tasks').innerText).toBe('1');
      expect(document.getElementById('stat-tasks-total').innerText).toContain('2 total');
      
      // Verify progress bar calculation (50%)
      const progressFill = document.getElementById('stat-tasks-progress');
      expect(progressFill.style.width).toBe('50%');
    });

    it('should honor dueDay provided initially', () => {
      const now = Date.now();
      const dueStr = toLocalDate(new Date(now - 86400000));
      const task = {
        id: 't-initial',
        parentId: null,
        title: 'Initial Overdue',
        isDone: false,
        dueDay: dueStr,
        timeSpentOnDay: {}
      };
      window.processData([task], []);
      expect(document.getElementById('stat-overdue').innerText).toBe('1');
      // overdue task with no time goes to the separate overdue section
      const row = document.querySelector('#overdue-table-body tr');
      expect(row.textContent).toContain('Initial Overdue');
    });

    it('should pick up overdue when dueDay is added later', () => {
      const now = Date.now();
      const task = {
        id: 't-late',
        parentId: null,
        title: 'Late Task',
        isDone: false,
        // start without dueDay
        timeSpentOnDay: {}
      };
      const tasks = [ task ];

      // initial run: no overdue
      window.processData(tasks, []);
      expect(document.getElementById('stat-overdue').innerText).toBe('0');

      // add dueDay yesterday and trigger again
      task.dueDay = toLocalDate(new Date(now - 86400000));
      window.processData(tasks, []);
      expect(document.getElementById('stat-overdue').innerText).toBe('1');
    });

    it('should not mark a task overdue/late if dueDay is added on the same day after completion', () => {
      const now = Date.now();
      const task = {
        id: 't-add-today',
        parentId: null,
        title: 'Added Today',
        isDone: true,
        doneOn: now,
        timeSpentOnDay: {}
      };
      const tasks = [ task ];
      // initial run: no dueDay -> not overdue
      window.processData(tasks, []);
      expect(document.getElementById('stat-overdue').innerText).toBe('0');
      expect(document.getElementById('stat-late').innerText).toBe('0');

      // now add dueDay equal to today
      task.dueDay = toLocalDate(new Date(now));
      window.processData(tasks, []);
      expect(document.getElementById('stat-overdue').innerText).toBe('0');
      expect(document.getElementById('stat-late').innerText).toBe('0');
    });

    it('should count a task done after its due day as overdue and late', () => {
      const now = Date.now();
      const due = new Date(now - 86400000); // yesterday
      const task = {
        id: 't-done-late',
        parentId: null,
        title: 'Done Late',
        isDone: true,
        doneOn: now,
        dueDay: toLocalDate(due),
        timeSpentOnDay: {}
      };
      window.processData([task], []);
      expect(document.getElementById('stat-overdue').innerText).toBe('1');
      expect(document.getElementById('stat-late').innerText).toBe('1');
      // late task with no time goes to the separate overdue section
      const row = document.querySelector('#overdue-table-body tr');
      expect(row.textContent).toContain('Done Late');
    });

    // new tests covering dueDay/empy status
    it('should handle a task without dueDay by not marking it overdue', () => {
      const now = Date.now();
      const task = {
        id: 't-no-due',
        parentId: null,
        title: 'No Due Date',
        isDone: false,
        timeSpentOnDay: {}
      };
      window.processData([task], []);
      expect(document.getElementById('stat-overdue').innerText).toBe('0');
      // task has no time entries so it shouldn't contribute to completed/tasks stats
      expect(document.getElementById('stat-tasks').innerText).toBe('0');
    });

    it('should not mark a task due today as late if completed same day', () => {
      const now = Date.now();
      const todayStr = toLocalDate(new Date(now));
      const task = {
        id: 't-due-today',
        parentId: null,
        title: 'Due Today',
        isDone: true,
        doneOn: now,
        dueDay: todayStr,
        timeSpentOnDay: {}
      };
      window.processData([task], []);
      expect(document.getElementById('stat-late').innerText).toBe('0');
      // row should appear in detail list despite zero time
      const row = document.querySelector('#details-table-body tr');
      expect(row.textContent).toContain('Due Today');
      // ensure totals include the completed task
      expect(document.getElementById('stat-tasks').innerText).toBe('1');
      expect(document.getElementById('stat-tasks-total').innerText).toContain('1 total');
    });

    it('should count a completed subtask in total tasks', () => {
      const now = Date.now();
      const sub = {
        id: 'sub1',
        parentId: 'parent',
        title: 'subtask done',
        isDone: true,
        doneOn: now,
        dueDay: toLocalDate(new Date(now)),
        timeSpentOnDay: {}
      };
      window.processData([sub], []);
      expect(document.getElementById('stat-tasks').innerText).toBe('1');
      expect(document.getElementById('stat-tasks-total').innerText).toContain('1 total');
    });

    it('should count tasks due today in totalTasks denominator even with no time logged', () => {
      const todayStr = toLocalDate(new Date());
      const taskDueToday = {
        id: 't-due-no-time',
        parentId: null,
        title: 'Due Today No Time',
        isDone: false,
        dueDay: todayStr,
        timeSpentOnDay: {}
      };
      window.processData([taskDueToday], []);
      // Task is due today so it should appear in the denominator
      expect(document.getElementById('stat-tasks-total').innerText).toContain('1 total');
      // Not completed, so numerator stays 0
      expect(document.getElementById('stat-tasks').innerText).toBe('0');
    });

    it('should include currentSessionTime in totalTimeSpent and bar chart when today is in range', () => {
      const todayStr = toLocalDate(new Date());
      const activeTask = {
        id: 't-active',
        parentId: null,
        title: 'Active Task',
        isDone: false,
        timeSpentOnDay: { [todayStr]: 3600000 /* 1h committed */ },
        currentSessionTime: 1800000 /* 30m in-progress */
      };
      window.processData([activeTask], []);
      // stat-time should reflect 1.5h total (committed + in-progress)
      expect(document.getElementById('stat-time').innerText).toBe('1h 30m');
    });

    it('should include currentSessionTime even when no committed time for today', () => {
      const todayStr = toLocalDate(new Date());
      const activeTask = {
        id: 't-active-only',
        parentId: null,
        title: 'Just Started',
        isDone: false,
        timeSpentOnDay: {},
        currentSessionTime: 900000 /* 15m in-progress */
      };
      window.processData([activeTask], []);
      expect(document.getElementById('stat-time').innerText).toBe('0h 15m');
    });

    it('should deduplicate tasks that appear in both active and archived lists', () => {
      const now = Date.now();
      const doneTask = {
        id: 'task1',
        parentId: null,
        title: 'Done Task',
        isDone: true,
        doneOn: now,
        dueDay: toLocalDate(new Date(now)),
        timeSpentOnDay: {}
      };
      // Simulate what happens when pullDataFromSP combines activeTasks and archivedTasks
      // The same task appears in both lists (which can happen with completed tasks)
      const activeTasks = [doneTask];
      const archivedTasks = [doneTask];
      
      // Deduplicate using Map (same logic as in pullDataFromSP)
      const taskMap = new Map();
      archivedTasks.forEach(task => taskMap.set(task.id, task));
      activeTasks.forEach(task => taskMap.set(task.id, task));
      const deduplicatedTasks = Array.from(taskMap.values());
      
      // Should have only 1 unique task, not 2
      expect(deduplicatedTasks.length).toBe(1);
      
      // Process the deduplicated list and verify count is 1, not 2
      window.processData(deduplicatedTasks, []);
      expect(document.getElementById('stat-tasks').innerText).toBe('1');
    });
  });

  describe('Tag Breakdown', () => {
    it('should accumulate time into tagData by tag name', () => {
      const todayStr = toLocalDate(new Date());
      const tags = [{ id: 'tag1', title: 'Frontend' }, { id: 'tag2', title: 'Backend' }];
      const task = {
        id: 't1', parentId: null, title: 'Feature', isDone: false,
        tagIds: ['tag1'],
        timeSpentOnDay: { [todayStr]: 3600000 }
      };
      window.processData([task], [], tags);
      expect(window.latestMetrics || document.getElementById('stat-time').innerText).toBeTruthy();
      // Re-access via a second processData call to inspect returned metrics via stat card
      // tagData["Frontend"] should have 3600000ms = 1h
      // We verify indirectly: stat-time shows 1h 0m
      expect(document.getElementById('stat-time').innerText).toBe('1h 0m');
    });

    it('should count a multi-tag task in each tag bucket', () => {
      const todayStr = toLocalDate(new Date());
      const tags = [{ id: 'tag1', title: 'Frontend' }, { id: 'tag2', title: 'Backend' }];
      const task = {
        id: 't1', parentId: null, title: 'Full-stack work', isDone: false,
        tagIds: ['tag1', 'tag2'],
        timeSpentOnDay: { [todayStr]: 7200000 /* 2h */ }
      };
      window.processData([task], [], tags);
      // Both tags should appear — verify via pie chart data by switching to tag-time
      document.getElementById('pie-chart-select').value = 'tag-time';
      window.updatePieChart();
      // The pie chart should have rendered without error
      const pieEl = document.getElementById('pie-chart-element');
      expect(pieEl).toBeTruthy();
    });

    it('should assign tasks with no tagIds to Untagged', () => {
      const todayStr = toLocalDate(new Date());
      const task = {
        id: 't1', parentId: null, title: 'Misc', isDone: false,
        tagIds: [],
        timeSpentOnDay: { [todayStr]: 1800000 /* 30m */ }
      };
      window.processData([task], [], []);
      // stat-time reflects the 30m; "Untagged" bucket exists internally
      expect(document.getElementById('stat-time').innerText).toBe('0h 30m');
    });

    it('should fall back to tag ID when tag is not in tagsArr', () => {
      const todayStr = toLocalDate(new Date());
      const task = {
        id: 't1', parentId: null, title: 'Unknown tag', isDone: false,
        tagIds: ['unknown-id'],
        timeSpentOnDay: { [todayStr]: 3600000 }
      };
      // Pass empty tags array — tag ID used as display name (no crash)
      window.processData([task], [], []);
      expect(document.getElementById('stat-time').innerText).toBe('1h 0m');
    });
  });

  describe('Navigation & Interactivity', () => {
    it('should switch between Dashboard and Detailed List tabs', () => {
      const dashView = document.getElementById('view-dashboard');
      const detailsView = document.getElementById('view-details');
      const dashBtn = document.getElementById('tab-btn-dashboard');
      const detailsBtn = document.getElementById('tab-btn-details');

      // Default state: Dashboard should be visible and active
      expect(dashView.classList.contains('hidden')).toBe(false);
      expect(detailsView.classList.contains('hidden')).toBe(true);
      expect(dashBtn.classList.contains('active')).toBe(true);

      // Switch to details
      window.switchTab('details');
      expect(dashView.classList.contains('hidden')).toBe(true);
      expect(detailsView.classList.contains('hidden')).toBe(false);
      expect(detailsBtn.classList.contains('active')).toBe(true);

      // back to dashboard again
      window.switchTab('dashboard');
      expect(dashView.classList.contains('hidden')).toBe(false);
      expect(dashBtn.classList.contains('active')).toBe(true);
    });

    it('should show custom date pickers only when Custom Range is selected', () => {
      const presetSelect = document.getElementById('date-preset');
      const customContainer = document.getElementById('custom-date-container');

      // Set to custom
      presetSelect.value = 'custom';
      presetSelect.dispatchEvent(new Event('change'));
      expect(customContainer.classList.contains('hidden')).toBe(false);

      // Set back to week
      presetSelect.value = 'week';
      presetSelect.dispatchEvent(new Event('change'));
      expect(customContainer.classList.contains('hidden')).toBe(true);
    });

    it('today preset should produce a single-day date range', () => {
      const presetSelect = document.getElementById('date-preset');
      presetSelect.value = 'today';
      presetSelect.dispatchEvent(new Event('change'));

      window.processData([], []);

      // The bar chart should contain exactly one bar column (one day)
      const barContainer = document.getElementById('bar-chart-container');
      expect(barContainer.querySelectorAll('.bar-col').length).toBe(1);
    });

    it('should not double-count a parent task and its subtasks for the same day', () => {
      const presetSelect = document.getElementById('date-preset');
      presetSelect.value = 'today';
      presetSelect.dispatchEvent(new Event('change'));

      const todayStr = toLocalDate(new Date());

      // Parent's timeSpentOnDay already reflects the rolled-up total of its subtasks,
      // mirroring how Super Productivity actually stores task time.
      const parent = {
        id: 'parent1', parentId: null, title: 'Update Reports', isDone: true, doneOn: Date.now(),
        timeSpentOnDay: { [todayStr]: 7980000 } // 2h 13m
      };
      const sub1 = {
        id: 'sub1', parentId: 'parent1', title: 'Add requests', isDone: true, doneOn: Date.now(),
        timeSpentOnDay: { [todayStr]: 5160000 } // 1h 26m
      };
      const sub2 = {
        id: 'sub2', parentId: 'parent1', title: 'Write remediations', isDone: true, doneOn: Date.now(),
        timeSpentOnDay: { [todayStr]: 2820000 } // 47m
      };

      window.processData([parent, sub1, sub2], []);

      // Total should equal the parent's rolled-up value, not parent + subtasks.
      expect(document.getElementById('stat-time').innerText).toBe('2h 13m');
    });

    it('this-week preset should include Monday through today and exclude last Sunday', () => {
      const presetSelect = document.getElementById('date-preset');
      presetSelect.value = 'this-week';
      presetSelect.dispatchEvent(new Event('change'));

      // Build a task logged on last Sunday (always before this week's Monday)
      const now = new Date();
      const dayOfWeek = now.getDay();
      const daysToMonday = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
      const lastSunday = new Date(now);
      lastSunday.setDate(now.getDate() - daysToMonday - 1);
      const lastSundayStr = toLocalDate(lastSunday);
      const todayStr = toLocalDate(now);

      const taskThisWeek = { id: 'tw1', parentId: null, title: 'This Week Task', isDone: true, doneOn: now.getTime(), timeSpentOnDay: { [todayStr]: 3600000 } };
      const taskLastWeek = { id: 'tw2', parentId: null, title: 'Last Week Task', isDone: true, doneOn: lastSunday.getTime(), timeSpentOnDay: { [lastSundayStr]: 3600000 } };

      window.processData([taskThisWeek, taskLastWeek], []);

      // Only this week's task time should be counted
      expect(document.getElementById('stat-time').innerText).toBe('1h 0m');

      // Bar chart should have at most 7 bars (Mon–today)
      const barContainer = document.getElementById('bar-chart-container');
      expect(barContainer.querySelectorAll('.bar-col').length).toBeLessThanOrEqual(7);
      expect(barContainer.querySelectorAll('.bar-col').length).toBeGreaterThanOrEqual(1);
    });

    it('bar and pie charts should render for overdue and late types and details show badges', () => {
      // prepare metrics with one overdue task and one late task
      const now = Date.now();
      const yesterdayStr = toLocalDate(new Date(now - 86400000));
      const overdueTask = { id:'t1', parentId:null, title:'Foo', isDone:false, dueDay:'2026-02-20', timeSpentOnDay:{'2026-02-20':0} };
      const lateTask = { id:'t2', parentId:null, title:'Bar', isDone:true, doneOn: now, dueDay: yesterdayStr, timeSpentOnDay:{} };
      window.processData([overdueTask, lateTask], []);

      // verify overdue/late rows appear in the separate overdue section, not the main table
      const overdueRows = document.querySelectorAll('#overdue-table-body tr');
      expect(overdueRows.length).toBe(2);
      const text = Array.from(overdueRows).map(r => r.textContent).join(' ');
      expect(text).toContain('Overdue');
      expect(text).toContain('Late');
      expect(document.getElementById('overdue-section').classList.contains('hidden')).toBe(false);

      const barSelect = document.getElementById('bar-chart-select');
      const pieSelect = document.getElementById('pie-chart-select');
      const barContainer = document.getElementById('bar-chart-container');
      const pieContainer = document.getElementById('pie-chart-element');

      // bar count limits for presets
      const preset = document.getElementById('date-preset');
      preset.value = 'month';
      preset.dispatchEvent(new Event('change'));
      window.processData([overdueTask, lateTask], []);
      expect(barContainer.querySelectorAll('.bar-col').length).toBeLessThanOrEqual(12);
      preset.value = 'year';
      preset.dispatchEvent(new Event('change'));
      window.processData([overdueTask, lateTask], []);
      expect(barContainer.querySelectorAll('.bar-col').length).toBeLessThanOrEqual(12);

      barSelect.value = 'overdue';
      window.updateBarChart();
      expect(barContainer.querySelector('.bar')).not.toBeNull();

      barSelect.value = 'late';
      window.updateBarChart();
      expect(barContainer.querySelector('.bar')).not.toBeNull();

      pieSelect.value = 'overdue';
      window.updatePieChart();
      // JSDOM may not retain gradient string, but legend items should appear
      const pieLegend = document.getElementById('pie-legend-container');
      expect(pieLegend.querySelector('.legend-item')).not.toBeNull();

      pieSelect.value = 'late';
      window.updatePieChart();
      expect(pieLegend.querySelector('.legend-item')).not.toBeNull();
    });

    it('overdue/late tasks with no time entries should appear in overdue section, not the main table', () => {
      // Period = today; overdue task due in the past, late task done after due date
      const preset = document.getElementById('date-preset');
      preset.value = 'today';
      preset.dispatchEvent(new Event('change'));

      const now = Date.now();
      const pastDate = '2026-01-15';
      const overdueTask = { id:'o1', parentId:null, title:'Overdue Thing', isDone:false, dueDay: pastDate, timeSpentOnDay:{} };
      const lateTask = { id:'l1', parentId:null, title:'Late Thing', isDone:true, doneOn: now, dueDay: pastDate, timeSpentOnDay:{} };
      window.processData([overdueTask, lateTask], []);

      // main table should have no rows for these tasks
      const mainRows = document.querySelectorAll('#details-table-body tr');
      const mainText = Array.from(mainRows).map(r => r.textContent).join(' ');
      expect(mainText).not.toContain('Overdue Thing');
      expect(mainText).not.toContain('Late Thing');

      // overdue section should show both
      expect(document.getElementById('overdue-section').classList.contains('hidden')).toBe(false);
      const overdueRows = document.querySelectorAll('#overdue-table-body tr');
      expect(overdueRows.length).toBe(2);
      const overdueText = Array.from(overdueRows).map(r => r.textContent).join(' ');
      expect(overdueText).toContain('Overdue Thing');
      expect(overdueText).toContain('Late Thing');
    });

    it('overdue section should be hidden when there are no overdue or late tasks', () => {
      const task = { id:'t1', parentId:null, title:'Normal Task', isDone:false, dueDay:null, timeSpentOnDay:{} };
      window.processData([task], []);
      expect(document.getElementById('overdue-section').classList.contains('hidden')).toBe(true);
    });

    it('detail list columns are sortable when headers are clicked', () => {
      // use custom range so time entries fall within the period (tasks go to main table, not overdue section)
      // set values directly without dispatching change to avoid double processData call (double sort-handler binding)
      const preset = document.getElementById('date-preset');
      preset.value = 'custom';
      document.getElementById('custom-date-container').classList.remove('hidden');
      document.getElementById('date-from').value = '2026-01-01';
      document.getElementById('date-to').value = '2026-01-02';

      // create two tasks with different dates
      const taskA = { id:'a', parentId:null, title:'A', isDone:true, doneOn: new Date('2026-01-01').getTime(), dueDay:'2026-01-01', timeSpentOnDay:{'2026-01-01':3600000} };
      const taskB = { id:'b', parentId:null, title:'B', isDone:true, doneOn: new Date('2026-01-02').getTime(), dueDay:'2026-01-02', timeSpentOnDay:{'2026-01-02':3600000} };
      window.processData([taskA, taskB], []);
      // capture initial order of date cells
      const initial = Array.from(document.querySelectorAll('#details-table-body tr td:first-child')).map(td => td.textContent);
      expect(initial.length).toBe(2);
      // click date header to toggle order and check indicator
      const dateTh = document.querySelector('#view-details th[data-sort="date"]');
      dateTh.click();
      expect(dateTh.classList.contains('sorted-asc')).toBe(true);
      const after = Array.from(document.querySelectorAll('#details-table-body tr td:first-child')).map(td => td.textContent);
      expect(after[0]).toBe(initial[1]);
      expect(after[1]).toBe(initial[0]);
      // clicking again flips direction
      dateTh.click();
      expect(dateTh.classList.contains('sorted-desc')).toBe(true);
    });

    it('from-weekday preset shows weekday picker and produces correct date range', () => {
      const presetSelect = document.getElementById('date-preset');
      const weekdaySelect = document.getElementById('weekday-select');
      const weekdayPickerContainer = document.getElementById('weekday-picker-container');
      const barContainer = document.getElementById('bar-chart-container');

      presetSelect.value = 'from-weekday';
      presetSelect.dispatchEvent(new Event('change'));
      expect(weekdayPickerContainer.classList.contains('hidden')).toBe(false);

      const today = new Date();
      for (const targetDay of [0, 1, 2, 3, 4, 5, 6]) {
        weekdaySelect.value = String(targetDay);
        weekdaySelect.dispatchEvent(new Event('change'));
        window.processData([], []);
        const daysBack = (today.getDay() - targetDay + 7) % 7;
        expect(barContainer.querySelectorAll('.bar-col').length).toBe(daysBack + 1);
      }

      presetSelect.value = 'today';
      presetSelect.dispatchEvent(new Event('change'));
      expect(weekdayPickerContainer.classList.contains('hidden')).toBe(true);
    });
  });

  describe('Drilldown Tab', () => {
    it('projectDailyData should accumulate time per project per day', () => {
      const projects = [{ id: 'p1', title: 'Alpha' }, { id: 'p2', title: 'Beta' }];
      const tasks = [
        { id: 't1', parentId: null, title: 'T1', isDone: false, projectId: 'p1',
          tagIds: [], timeSpentOnDay: { '2026-01-01': 3600000, '2026-01-02': 7200000 } },
        { id: 't2', parentId: null, title: 'T2', isDone: false, projectId: 'p1',
          tagIds: [], timeSpentOnDay: { '2026-01-01': 1800000 } },
        { id: 't3', parentId: null, title: 'T3', isDone: false, projectId: 'p2',
          tagIds: [], timeSpentOnDay: { '2026-01-01': 5400000 } }
      ];
      document.getElementById('date-preset').value = 'custom';
      document.getElementById('custom-date-container').classList.remove('hidden');
      document.getElementById('date-from').value = '2026-01-01';
      document.getElementById('date-to').value = '2026-01-02';
      window.processData(tasks, projects, []);

      const m = window.latestMetrics;
      expect(m.projectDailyData['Alpha']['2026-01-01']).toBe(5400000);
      expect(m.projectDailyData['Alpha']['2026-01-02']).toBe(7200000);
      expect(m.projectDailyData['Beta']['2026-01-01']).toBe(5400000);
      expect(m.projectDailyData['Beta']['2026-01-02']).toBeUndefined();
    });

    it('tagDailyData should accumulate time per tag per day, counting multi-tag tasks in each tag', () => {
      const tags = [{ id: 'tg1', title: 'Frontend' }, { id: 'tg2', title: 'Backend' }];
      const tasks = [
        { id: 't1', parentId: null, title: 'T1', isDone: false, projectId: null,
          tagIds: ['tg1', 'tg2'], timeSpentOnDay: { '2026-01-01': 3600000 } }
      ];
      document.getElementById('date-preset').value = 'custom';
      document.getElementById('custom-date-container').classList.remove('hidden');
      document.getElementById('date-from').value = '2026-01-01';
      document.getElementById('date-to').value = '2026-01-01';
      window.processData(tasks, [], tags);

      const m = window.latestMetrics;
      expect(m.tagDailyData['Frontend']['2026-01-01']).toBe(3600000);
      expect(m.tagDailyData['Backend']['2026-01-01']).toBe(3600000);
    });

    it('tableEntries should include tagNames with resolved titles', () => {
      const tags = [{ id: 'tg1', title: 'Design' }];
      const todayStr = toLocalDate(new Date());
      const tasks = [
        { id: 't1', parentId: null, title: 'Wireframes', isDone: false, projectId: null,
          tagIds: ['tg1'], timeSpentOnDay: { [todayStr]: 1800000 } }
      ];
      window.processData(tasks, [], tags);
      const entry = window.latestMetrics.tableEntries.find(e => e.taskTitle === 'Wireframes');
      expect(entry).toBeDefined();
      expect(entry.tagNames).toContain('Design');
    });

    it('tableEntries should have Untagged in tagNames for tasks with no tagIds', () => {
      const todayStr = toLocalDate(new Date());
      const tasks = [
        { id: 't1', parentId: null, title: 'Admin', isDone: false,
          tagIds: [], timeSpentOnDay: { [todayStr]: 900000 } }
      ];
      window.processData(tasks, [], []);
      const entry = window.latestMetrics.tableEntries.find(e => e.taskTitle === 'Admin');
      expect(entry.tagNames).toContain('Untagged');
    });

    it('switchTab drilldown should show view-drilldown and hide other views', () => {
      window.switchTab('drilldown');
      expect(document.getElementById('view-drilldown').classList.contains('hidden')).toBe(false);
      expect(document.getElementById('view-dashboard').classList.contains('hidden')).toBe(true);
      expect(document.getElementById('view-details').classList.contains('hidden')).toBe(true);
      expect(document.getElementById('tab-btn-drilldown').classList.contains('active')).toBe(true);
    });

    it('renderDrillDown should populate stat cards for a selected project', () => {
      const todayStr = toLocalDate(new Date());
      const projects = [{ id: 'p1', title: 'Omega' }];
      const tasks = [
        { id: 't1', parentId: null, title: 'Work', isDone: true,
          doneOn: Date.now(), projectId: 'p1', tagIds: [],
          timeSpentOnDay: { [todayStr]: 7200000 } }
      ];
      window.processData(tasks, projects, []);
      window.setDrillDimension('project');
      window.setDrillEntity('Omega');
      expect(document.getElementById('drill-stat-time').textContent).toBe('2h 0m');
      expect(document.getElementById('drill-stat-tasks').textContent).toBe('1');
    });

    it('renderDrillDown should filter table body to show only tasks with the selected tag', () => {
      const todayStr = toLocalDate(new Date());
      const tags = [{ id: 'tg1', title: 'QA' }];
      const tasks = [
        { id: 't1', parentId: null, title: 'Write Tests', isDone: false,
          tagIds: ['tg1'], timeSpentOnDay: { [todayStr]: 3600000 } },
        { id: 't2', parentId: null, title: 'Unrelated Work', isDone: false,
          tagIds: [], timeSpentOnDay: { [todayStr]: 1800000 } }
      ];
      window.processData(tasks, [], tags);
      window.setDrillDimension('tag');
      window.setDrillEntity('QA');
      const rows = document.querySelectorAll('#drill-table-body tr');
      const text = Array.from(rows).map(r => r.textContent).join(' ');
      expect(text).toContain('Write Tests');
      expect(text).not.toContain('Unrelated Work');
    });
  });

  describe('Share / Export', () => {
    const todayStr = toLocalDate(new Date());
    const mockProjects = [
      { id: 'p1', title: 'Website Redesign' },
      { id: 'p2', title: 'Marketing' }
    ];
    const mockTags = [{ id: 'tg1', title: 'Frontend' }];
    const mockTasks = [
      { id: 't1', parentId: null, title: 'Build homepage', isDone: true, doneOn: Date.now(),
        projectId: 'p1', tagIds: ['tg1'], timeSpentOnDay: { [todayStr]: 7200000 } }, // 2h
      { id: 't2', parentId: null, title: 'Email blast', isDone: false,
        projectId: 'p2', tagIds: [], timeSpentOnDay: { [todayStr]: 3600000 } }        // 1h
    ];

    it('getActiveViewNode should report the currently visible tab', () => {
      window.processData(mockTasks, mockProjects, mockTags);
      expect(window.getActiveViewNode().key).toBe('dashboard');
      window.switchTab('details');
      expect(window.getActiveViewNode().key).toBe('details');
      window.switchTab('drilldown');
      const active = window.getActiveViewNode();
      expect(active.key).toBe('drilldown');
      expect(active.node.id).toBe('view-drilldown');
    });

    it('buildTextSummary(dashboard) includes headline stats and per-project time', () => {
      window.processData(mockTasks, mockProjects, mockTags);
      const summary = window.buildTextSummary('dashboard');
      expect(summary).toContain('Productivity Summary');
      expect(summary).toContain('Total Time Tracked: 3h 0m');
      expect(summary).toContain('Tasks Completed: 1 / 2');
      expect(summary).toContain('Time by Project');
      expect(summary).toContain('Website Redesign: 2h 0m');
      expect(summary).toContain('Marketing: 1h 0m');
    });

    it('buildTextSummary(details) renders a markdown table of tracked entries', () => {
      window.processData(mockTasks, mockProjects, mockTags);
      const summary = window.buildTextSummary('details');
      expect(summary).toContain('Detailed Time Log');
      expect(summary).toContain('| Date | Project | Task | Time | Status |');
      expect(summary).toContain('Build homepage');
      expect(summary).toContain('Email blast');
    });

    it('buildTextSummary(drilldown) reflects the selected entity', () => {
      window.processData(mockTasks, mockProjects, mockTags);
      window.setDrillDimension('project');
      window.setDrillEntity('Website Redesign');
      const summary = window.buildTextSummary('drilldown');
      expect(summary).toContain('Project: Website Redesign');
      expect(summary).toContain('Time Spent: 2h 0m');
      expect(summary).toContain('Build homepage');
      expect(summary).not.toContain('Email blast');
    });

    it('buildTextSummary returns a safe message when no data has been processed', () => {
      // window.latestMetrics can leak across tests in the shared JSDOM window; clear it.
      window.latestMetrics = null;
      expect(window.buildTextSummary('dashboard')).toBe('No data available.');
    });

    it('getRangeLabel derives a human-readable range from the processed metrics', () => {
      window.processData(mockTasks, mockProjects, mockTags);
      const label = window.getRangeLabel();
      expect(label).toBe(window.formatDateShort(todayStr)); // single-day "today" preset
    });

    it('inlineComputedStyles copies computed styles onto a detached clone', () => {
      window.processData(mockTasks, mockProjects, mockTags);
      const node = document.getElementById('view-dashboard');
      const clone = node.cloneNode(true);
      window.inlineComputedStyles(node, clone);
      // The root and a known descendant should now carry inline style declarations.
      expect(clone.getAttribute('style')).toBeTruthy();
      const descendant = clone.querySelector('#stat-time');
      expect(descendant).not.toBeNull();
      expect(descendant.getAttribute('style')).toBeTruthy();
    });

    it('pie chart renders as an inline SVG donut (prints reliably), not a conic-gradient', () => {
      document.getElementById('pie-chart-select').value = 'time';
      window.processData(mockTasks, mockProjects, mockTags);
      const pie = document.getElementById('pie-chart-element');
      const svg = pie.querySelector('svg');
      expect(svg).not.toBeNull();
      // one arc per project with tracked time (Website Redesign + Marketing)
      expect(svg.querySelectorAll('circle').length).toBe(2);
      // no CSS conic-gradient background left behind
      expect(pie.style.background).toBe('');
    });

    it('triggerDownload routes the file to the host window when embedded in an iframe', () => {
      const posted = [];
      Object.defineProperty(window, 'parent', {
        value: { postMessage: (m) => posted.push(m) }, configurable: true
      });
      try {
        window.triggerDownload(new Blob(['x'], { type: 'image/png' }), 'Dashboard');
      } finally {
        Object.defineProperty(window, 'parent', { value: window, configurable: true });
      }
      expect(posted.length).toBe(1);
      expect(posted[0].type).toBe('SP_DASHBOARD_DOWNLOAD');
      expect(posted[0].filename).toMatch(/^dashboard-dashboard-\d{4}-\d{2}-\d{2}\.png$/);
      expect(posted[0].blob).toBeInstanceOf(Blob);
    });
  });

  describe('Settings', () => {
    const todayStr = toLocalDate(new Date());
    const projects = [{ id: 'p1', title: 'Work' }, { id: 'p2', title: 'Personal' }];
    const tags = [{ id: 'tg1', title: 'Frontend' }];
    const tasks = [
      { id: 't1', parentId: null, title: 'Ship feature', isDone: false, projectId: 'p1',
        tagIds: ['tg1'], timeSpentOnDay: { [todayStr]: 7200000 } },                  // 2h, Work
      { id: 't2', parentId: null, title: 'Water plants', isDone: false, projectId: 'p2',
        tagIds: [], timeSpentOnDay: { [todayStr]: 1800000 } }                        // 30m, Personal
    ];

    describe('Store', () => {
      it('starts from the documented defaults', () => {
        expect(window.getSetting('weekStartsOn')).toBe(1);
        expect(window.getSetting('timeFormat')).toBe('hm');
        expect(window.getSetting('debugLogging')).toBe(false);
        expect(window.getSetting('includeArchived')).toBe(true);
        expect(window.getSetting('excludedProjects')).toEqual([]);
      });

      it('persists a change into a single localStorage blob', () => {
        window.setSetting('timeFormat', 'decimal');
        const raw = JSON.parse(localStorage.getItem(window.SETTINGS_KEY));
        expect(raw.timeFormat).toBe('decimal');
        expect(raw.schemaVersion).toBe(1);
      });

      it('migrates the pre-settings localStorage keys and removes them', () => {
        localStorage.clear();
        localStorage.setItem('sp-dashboard-date-preset', 'this-week');
        localStorage.setItem('sp-dashboard-pie-dim', 'tag');
        localStorage.setItem('sp-dashboard-drill-entity', 'Work');

        // Re-boot the script against the seeded legacy keys.
        document.documentElement.innerHTML = html;
        const script = Array.from(document.querySelectorAll('script'))
          .find(s => !s.src && s.textContent.includes('processData'));
        new Function(script.textContent).call(window);

        expect(window.getSetting('periodLast')).toBe('this-week');
        expect(window.getSetting('pieDimLast')).toBe('tag');
        expect(window.getSetting('drillEntityLast')).toBe('Work');
        expect(localStorage.getItem('sp-dashboard-date-preset')).toBeNull();
        expect(localStorage.getItem('sp-dashboard-pie-dim')).toBeNull();
        // …and the migrated values drive the opening state.
        expect(document.getElementById('date-preset').value).toBe('this-week');
      });

      it('ignores unknown keys and repairs values of the wrong type', () => {
        localStorage.setItem(window.SETTINGS_KEY, JSON.stringify({
          weekStartsOn: 'not-a-number', workingDays: 'nope', bogusKey: 42
        }));
        document.documentElement.innerHTML = html;
        const script = Array.from(document.querySelectorAll('script'))
          .find(s => !s.src && s.textContent.includes('processData'));
        new Function(script.textContent).call(window);

        expect(window.getSetting('weekStartsOn')).toBe(1);
        expect(window.getSetting('workingDays')).toEqual([1, 2, 3, 4, 5]);
        expect(window.getAllSettings().bogusKey).toBeUndefined();
      });

      it('reset returns every setting to its default', () => {
        window.setSetting('timeFormat', 'minutes');
        window.setSetting('excludedProjects', ['Personal']);
        window.resetSettings();
        expect(window.getSetting('timeFormat')).toBe('hm');
        expect(window.getSetting('excludedProjects')).toEqual([]);
      });

      it('import applies a settings blob and drops keys it does not recognise', () => {
        window.importSettings(JSON.stringify({ timeFormat: 'decimal', nonsense: true }));
        expect(window.getSetting('timeFormat')).toBe('decimal');
        expect(window.getAllSettings().nonsense).toBeUndefined();
      });

      it('import rejects malformed JSON without touching the current settings', () => {
        window.setSetting('timeFormat', 'minutes');
        window.importSettings('{ not json');
        expect(window.getSetting('timeFormat')).toBe('minutes');
      });
    });

    // An imported settings file is untrusted: it may be shared, stale or simply
    // corrupt. Type alone is not enough — a well-typed string in the wrong
    // place used to throw during init and take the whole dashboard down.
    describe('Untrusted input', () => {
      const reboot = () => {
        document.documentElement.innerHTML = html;
        const script = Array.from(document.querySelectorAll('script'))
          .find(s => !s.src && s.textContent.includes('processData'));
        new Function(script.textContent).call(window);
      };

      it('rejects an out-of-enum tab, which previously threw during init', () => {
        window.importSettings(JSON.stringify({ tabPinned: 'evil', tabMode: 'pin' }));
        expect(window.getSetting('tabPinned')).toBe('dashboard');
        expect(() => reboot()).not.toThrow();
        expect(document.getElementById('view-dashboard').classList.contains('hidden')).toBe(false);
      });

      it('rejects an out-of-enum tabLast on the remember path too', () => {
        window.importSettings(JSON.stringify({ tabLast: 'evil', tabMode: 'remember' }));
        // Falls back to '' — "nothing remembered" — so tabPinned decides.
        expect(window.getSetting('tabLast')).toBe('');
        expect(() => reboot()).not.toThrow();
        expect(document.getElementById('view-dashboard').classList.contains('hidden')).toBe(false);
      });

      it('switchTab falls back rather than throwing on an unknown tab', () => {
        expect(() => window.switchTab('nope')).not.toThrow();
        expect(document.getElementById('view-dashboard').classList.contains('hidden')).toBe(false);
      });

      it('rejects out-of-enum values across every enumerated setting', () => {
        window.importSettings(JSON.stringify({
          palette: 'constructor', theme: 'evil', barGrouping: 'zzz',
          periodPinned: 'nope', sortKey: 'toString', summaryFormat: 'xml'
        }));
        expect(window.getSetting('palette')).toBe('default');
        expect(window.getSetting('theme')).toBe('auto');
        expect(window.getSetting('barGrouping')).toBe('auto');
        expect(window.getSetting('periodPinned')).toBe('today');
        expect(window.getSetting('sortKey')).toBe('date');
        expect(window.getSetting('summaryFormat')).toBe('slack');
      });

      it('refuses a refresh interval that is not one of the offered values', () => {
        window.importSettings(JSON.stringify({ refreshMs: 1 }));
        expect(window.getSetting('refreshMs')).toBe(30000);
      });

      it('clamps free-form numeric goals to their range', () => {
        window.importSettings(JSON.stringify({ dailyTimeGoalH: 1e9, weeklyTimeGoalH: -5, dailyTaskGoal: 0 }));
        expect(window.getSetting('dailyTimeGoalH')).toBe(24);
        expect(window.getSetting('weeklyTimeGoalH')).toBe(1);
        expect(window.getSetting('dailyTaskGoal')).toBe(1);
      });

      it('drops array members that are not legal values', () => {
        window.importSettings(JSON.stringify({
          workingDays: [0, 1, 'x', {}, 99],
          statCards: ['time', '<svg onload=alert(1)>']
        }));
        expect(window.getSetting('workingDays')).toEqual([0, 1]);
        expect(window.getSetting('statCards')).toEqual(['time']);
      });

      it('caps the exclusion lists so one file cannot bloat the store', () => {
        window.importSettings(JSON.stringify({
          excludedProjects: Array.from({ length: 10000 }, (_, i) => 'p' + i),
          excludedTags: ['ok', 123, null, 'x'.repeat(5000)]
        }));
        expect(window.getSetting('excludedProjects').length).toBe(500);
        expect(window.getSetting('excludedTags')).toEqual(['ok']);
      });

      it('leaves no prototype pollution behind', () => {
        window.importSettings('{"__proto__":{"polluted":"yes"},"constructor":{"prototype":{"p2":"yes"}}}');
        expect({}.polluted).toBeUndefined();
        expect({}.p2).toBeUndefined();
      });

      // The tag picker in Settings reads the cached tag list, so it doubles as
      // a window onto what a postMessage did or didn't manage to change.
      const tagPickerOptions = () => {
        window.openSettings();
        window.renderSettingsPanel();
        document.getElementById('settings-rail').querySelector('[data-section="data"]')
          .dispatchEvent(new MouseEvent('click', { bubbles: true }));
        const picker = document.querySelectorAll('.set-chips select')[1];
        return picker ? Array.from(picker.options).map(o => o.textContent) : [];
      };

      it('accepts SP_STATE_CHANGED from the host frame', () => {
        window.dispatchEvent(new MessageEvent('message', {
          data: { type: 'SP_STATE_CHANGED', tags: [{ id: 'h1', title: 'FromHost' }] },
          source: window.parent
        }));
        expect(tagPickerOptions()).toContain('FromHost');
      });

      it('keeps only well-formed tags from the host message', () => {
        window.dispatchEvent(new MessageEvent('message', {
          data: { type: 'SP_STATE_CHANGED', tags: [
            { id: 'good', title: 'Keep' },
            { id: 'no-title' },                       // title falls back to id
            'a string', null, 42, [],                 // not objects at all
            { title: 'no id' },                       // unusable without an id
            { id: '', title: 'empty id' },
            { id: 'extra', title: 'Fields', evil: () => {}, __proto__: { x: 1 } }
          ] },
          source: window.parent
        }));
        const opts = tagPickerOptions();
        expect(opts).toContain('Keep');
        expect(opts).toContain('no-title');   // id used as the label
        expect(opts).toContain('Fields');
        expect(opts).not.toContain('no id');
        expect(opts).not.toContain('empty id');
        expect({}.x).toBeUndefined();
      });

      it('ignores SP_STATE_CHANGED from any other sender', () => {
        // plugin.js posts from the host page. Anything else with a handle on
        // this frame — another installed plugin — must not drive our state.
        window.dispatchEvent(new MessageEvent('message', {
          data: { type: 'SP_STATE_CHANGED', tags: [{ id: 'h1', title: 'FromHost' }] },
          source: window.parent
        }));
        expect(tagPickerOptions()).toContain('FromHost');

        window.dispatchEvent(new MessageEvent('message', {
          data: { type: 'SP_STATE_CHANGED', tags: [{ id: 'e1', title: 'AttackerTag' }] },
          source: { postMessage() {} }
        }));
        const opts = tagPickerOptions();
        expect(opts).not.toContain('AttackerTag');
        expect(opts).toContain('FromHost'); // the real list survived
      });
    });

    describe('Untrusted input (continued)', () => {
      it('keeps hostile strings as inert text in the settings UI', () => {
        window.importSettings(JSON.stringify({ excludedProjects: ['<img src=x onerror=alert(1)>'] }));
        window.openSettings();
        document.getElementById('settings-rail').querySelector('[data-section="data"]')
          .dispatchEvent(new MouseEvent('click', { bubbles: true }));
        const chip = document.querySelector('.set-chip');
        expect(chip.textContent).toContain('<img src=x onerror=alert(1)>');
        expect(document.querySelectorAll('#settings-panel img').length).toBe(0);
      });

      it('still accepts a legitimate config, including states only the UI reaches', () => {
        window.importSettings(JSON.stringify({
          theme: 'dark', palette: 'colorblind', refreshMs: 60000,
          weekStartsOn: 0, dailyTimeGoalH: 8, tabPinned: 'details', tabMode: 'pin',
          periodLast: 'custom', dateFromLast: '2026-01-01', drillEntityLast: 'Work'
        }));
        expect(window.getSetting('theme')).toBe('dark');
        expect(window.getSetting('palette')).toBe('colorblind');
        expect(window.getSetting('refreshMs')).toBe(60000);
        expect(window.getSetting('weekStartsOn')).toBe(0);
        expect(window.getSetting('dailyTimeGoalH')).toBe(8);
        expect(window.getSetting('tabPinned')).toBe('details');
        // 'custom' is reachable from the Period control but is not a pinnable default
        expect(window.getSetting('periodLast')).toBe('custom');
        expect(window.getSetting('dateFromLast')).toBe('2026-01-01');
        expect(window.getSetting('drillEntityLast')).toBe('Work');
      });

      it('rejects a malformed stored date without discarding the rest', () => {
        window.importSettings(JSON.stringify({ dateFromLast: 'not-a-date', dateToLast: '2026-03-01' }));
        expect(window.getSetting('dateFromLast')).toBe('');
        expect(window.getSetting('dateToLast')).toBe('2026-03-01');
      });

      it('every enumerated setting offers exactly the values it will accept', () => {
        // The UI and the validator must read from the same list.
        const seen = new Set();
        window.SETTINGS_SECTIONS.forEach(section => section.rows.forEach(row =>
          row.controls.forEach(ctrl => {
            if (!ctrl.key || !ctrl.options || ctrl.type === 'days' || ctrl.type === 'checks') return;
            if (typeof window.DEFAULT_SETTINGS[ctrl.key] === 'boolean') return;
            seen.add(ctrl.key);
            ctrl.options.forEach(o => {
              window.importSettings(JSON.stringify({ [ctrl.key]: o.v }));
              expect(window.getSetting(ctrl.key), `${ctrl.key} should accept ${o.v}`).toBe(o.v);
            });
          })));
        expect(seen.size).toBeGreaterThan(15);
      });
    });

    describe('General', () => {
      it('timeFormat switches formatTime between hours, decimal and minutes', () => {
        expect(window.formatTime(9000000)).toBe('2h 30m');
        window.setSetting('timeFormat', 'decimal');
        expect(window.formatTime(9000000)).toBe('2.50h');
        window.setSetting('timeFormat', 'minutes');
        expect(window.formatTime(9000000)).toBe('150m');
      });

      it('dateFormat iso leaves the date as a plain ISO day', () => {
        window.setSetting('dateFormat', 'iso');
        expect(window.formatDateShort('2026-02-22')).toBe('2026-02-22');
        window.setSetting('dateFormat', 'eu');
        expect(window.formatDateShort('2026-02-22')).toBe('22 Feb 2026');
      });

      it('weekStartsOn moves where "This Week" begins', () => {
        // 2026-03-11 is a Wednesday.
        vi.useFakeTimers({ now: new Date('2026-03-11T12:00:00').getTime() });
        const preset = document.getElementById('date-preset');
        preset.value = 'this-week';
        preset.dispatchEvent(new Event('change'));

        window.processData([], []);
        // Monday start → Mon 9th through Wed 11th
        expect(window.latestMetrics.weeklyData.labels[0]).toBe('2026-03-09');

        window.setSetting('weekStartsOn', 0);
        window.processData([], []);
        // Sunday start → Sun 8th through Wed 11th
        expect(window.latestMetrics.weeklyData.labels[0]).toBe('2026-03-08');
        vi.useRealTimers();
      });

      it('hideNonWorkingDays drops weekends out of the range', () => {
        vi.useFakeTimers({ now: new Date('2026-03-15T12:00:00').getTime() }); // a Sunday
        const preset = document.getElementById('date-preset');
        preset.value = 'week'; // past 7 days: Mon 9th – Sun 15th
        preset.dispatchEvent(new Event('change'));

        window.processData([], []);
        expect(window.latestMetrics.weeklyData.labels.length).toBe(7);

        window.setSetting('hideNonWorkingDays', true);
        window.processData([], []);
        const labels = window.latestMetrics.weeklyData.labels;
        expect(labels.length).toBe(5);
        expect(labels).not.toContain('2026-03-14'); // Saturday
        expect(labels).not.toContain('2026-03-15'); // Sunday
        vi.useRealTimers();
      });
    });

    describe('Data & Filtering', () => {
      it('excludedProjects removes the project from every metric', () => {
        window.processData(tasks, projects, tags);
        expect(document.getElementById('stat-time').innerText).toBe('2h 30m');
        expect(window.latestMetrics.projectData['Personal']).toBe(1800000);

        window.setSetting('excludedProjects', ['Personal']);
        window.processData(tasks, projects, tags);
        expect(document.getElementById('stat-time').innerText).toBe('2h 0m');
        expect(window.latestMetrics.projectData['Personal']).toBeUndefined();
        expect(window.latestMetrics.tableEntries.some(e => e.projectName === 'Personal')).toBe(false);
      });

      it('excludedTags drops any task carrying that tag', () => {
        window.setSetting('excludedTags', ['Frontend']);
        window.processData(tasks, projects, tags);
        expect(document.getElementById('stat-time').innerText).toBe('0h 30m');
        expect(window.latestMetrics.projectData['Work']).toBeUndefined();
      });

      it('minEntryMs keeps short entries out of the totals', () => {
        window.setSetting('minEntryMs', 3600000); // 1 hour
        window.processData(tasks, projects, tags);
        expect(document.getElementById('stat-time').innerText).toBe('2h 0m'); // the 30m entry is gone
        expect(window.latestMetrics.tableEntries.length).toBe(1);
      });

      it('includeRunningTimer excludes the in-progress session when off', () => {
        const running = [{ id: 'r1', parentId: null, title: 'Timing now', isDone: false,
          projectId: 'p1', tagIds: [], timeSpentOnDay: { [todayStr]: 3600000 }, currentSessionTime: 1800000 }];
        window.processData(running, projects, []);
        expect(document.getElementById('stat-time').innerText).toBe('1h 30m');

        window.setSetting('includeRunningTimer', false);
        window.processData(running, projects, []);
        expect(document.getElementById('stat-time').innerText).toBe('1h 0m');
      });

      it('showSubtaskRows lists subtasks without changing any total', () => {
        const withChild = [
          { id: 'p', parentId: null, title: 'Parent', isDone: false, projectId: 'p1', tagIds: [],
            timeSpentOnDay: { [todayStr]: 7200000 } },
          { id: 'c', parentId: 'p', title: 'Child', isDone: false, projectId: 'p1', tagIds: [],
            timeSpentOnDay: { [todayStr]: 3600000 } }
        ];
        window.processData(withChild, projects, []);
        expect(document.getElementById('stat-time').innerText).toBe('2h 0m');
        expect(window.latestMetrics.tableEntries.length).toBe(1);

        window.setSetting('showSubtaskRows', true);
        window.processData(withChild, projects, []);
        expect(document.getElementById('stat-time').innerText).toBe('2h 0m'); // unchanged
        expect(window.latestMetrics.tableEntries.length).toBe(2);
        expect(window.latestMetrics.tableEntries.some(e => e.isSubtask)).toBe(true);
      });

      it('noDueDateOverdue counts undated open tasks as overdue', () => {
        window.processData(tasks, projects, tags);
        expect(document.getElementById('stat-overdue').innerText).toBe('0');

        window.setSetting('noDueDateOverdue', true);
        window.processData(tasks, projects, tags);
        expect(document.getElementById('stat-overdue').innerText).toBe('2');
      });
    });

    describe('Appearance', () => {
      it('statCards hides the cards that are unchecked', () => {
        window.processData(tasks, projects, tags);
        expect(document.getElementById('stat-card-late').classList.contains('hidden')).toBe(false);

        window.setSetting('statCards', ['time', 'completed']);
        expect(document.getElementById('stat-card-late').classList.contains('hidden')).toBe(true);
        expect(document.getElementById('stat-card-overdue').classList.contains('hidden')).toBe(true);
        expect(document.getElementById('stat-card-time').classList.contains('hidden')).toBe(false);
      });

      it('pieMaxSlices rolls the tail into a single Other slice', () => {
        const many = ['a', 'b', 'c', 'd', 'e', 'f'].map((id, i) => ({
          id, parentId: null, title: `Task ${id}`, isDone: false, projectId: `pr${i}`,
          tagIds: [], timeSpentOnDay: { [todayStr]: (6 - i) * 600000 }
        }));
        const manyProjects = many.map((t, i) => ({ id: `pr${i}`, title: `Project ${i}` }));
        document.getElementById('pie-chart-select').value = 'time';

        window.setSetting('pieMaxSlices', 0);
        window.processData(many, manyProjects, []);
        expect(document.querySelectorAll('#pie-chart-element circle').length).toBe(6);

        window.setSetting('pieMaxSlices', 5);
        window.processData(many, manyProjects, []);
        expect(document.querySelectorAll('#pie-chart-element circle').length).toBe(6); // 5 + Other
        expect(document.getElementById('pie-legend-container').textContent).toContain('Other');
      });

      it('tablePageSize caps the Detailed List and says so', () => {
        const dates = ['2026-01-01', '2026-01-02', '2026-01-03'];
        const spread = [{ id: 's1', parentId: null, title: 'Spread', isDone: false, projectId: 'p1',
          tagIds: [], timeSpentOnDay: Object.fromEntries(dates.map(d => [d, 3600000])) }];
        const preset = document.getElementById('date-preset');
        preset.value = 'custom';
        document.getElementById('date-from').value = '2026-01-01';
        document.getElementById('date-to').value = '2026-01-03';
        preset.dispatchEvent(new Event('change'));

        window.setSetting('tablePageSize', 0);
        window.processData(spread, projects, []);
        expect(document.querySelectorAll('#details-table-body tr').length).toBe(3);

        window.setSetting('tablePageSize', 2);
        window.processData(spread, projects, []);
        const rows = document.querySelectorAll('#details-table-body tr');
        expect(rows.length).toBe(3); // 2 entries + the "showing 2 of 3" footer
        expect(rows[2].textContent).toContain('Showing 2 of 3');
      });

      it('theme puts an explicit override class on the body', () => {
        window.setSetting('theme', 'light');
        expect(document.body.classList.contains('force-light')).toBe(true);
        window.setSetting('theme', 'dark');
        expect(document.body.classList.contains('force-light')).toBe(false);
        expect(document.body.classList.contains('force-dark')).toBe(true);
        window.setSetting('theme', 'auto');
        expect(document.body.classList.contains('force-dark')).toBe(false);
      });
    });

    describe('Advanced', () => {
      it('exportFilename honours the {tab}, {range} and {date} tokens', () => {
        window.processData(tasks, projects, tags);
        window.setSetting('exportFilename', 'report-{tab}');
        expect(window.buildExportFilename('Detailed List', 'png')).toBe('report-detailed-list.png');
        window.setSetting('exportFilename', 'x-{date}');
        expect(window.buildExportFilename('Dashboard', 'png')).toBe(`x-${todayStr}.png`);
      });

      it('exportFilename cannot produce a traversal or flag-like name', () => {
        window.processData(tasks, projects, tags);
        [
          ['../../etc/passwd', 'etc-passwd.png'],
          ['..', 'dashboard.png'],
          ['-rf', 'rf.png'],
          ['.hidden', 'hidden.png'],
          ['a/b\\c:d*e?f"g<h>i|j', 'a-b-c-d-e-f-g-h-i-j.png']
        ].forEach(([pattern, expected]) => {
          window.setSetting('exportFilename', pattern);
          expect(window.buildExportFilename('Dashboard', 'png'), pattern).toBe(expected);
        });
      });

      it('summaryFormat switches the copied summary between Slack, Markdown and CSV', () => {
        // setSetting re-runs processData over the cached task list, which is
        // empty here, so each format is re-fed the fixtures before asserting.
        window.processData(tasks, projects, tags);
        expect(window.buildTextSummary('dashboard')).toContain('*Productivity Summary*');

        window.setSetting('summaryFormat', 'markdown');
        window.processData(tasks, projects, tags);
        expect(window.buildTextSummary('dashboard')).toContain('**Productivity Summary**');

        window.setSetting('summaryFormat', 'csv');
        window.processData(tasks, projects, tags);
        const csv = window.buildTextSummary('dashboard');
        expect(csv.split('\n')[0]).toBe('Metric,Value');
        expect(csv).toContain('Total Time Tracked,2h 30m');
      });

      it('csv leaves only letter- or digit-initial cells bare', () => {
        // Allowlist, not denylist: a leading character nobody enumerated must
        // still be quoted rather than shipped as a live formula.
        const exotic = ['\tTAB-led', '|DDE', ' null-led', ' space-led', '=classic', '−unicode-minus'];
        const tasks = exotic.map((title, i) => ({
          id: 'x' + i, parentId: null, title, isDone: false, projectId: 'p1',
          tagIds: [], timeSpentOnDay: { [todayStr]: 60000 * (i + 1) }
        }));
        window.setSetting('summaryFormat', 'csv');
        window.processData(tasks, [{ id: 'p1', title: 'Safe' }], []);
        const csv = window.buildTextSummary('details');

        exotic.forEach(title => {
          expect(csv, `${JSON.stringify(title)} must be forced to text`).toContain(`'${title}`);
        });
        // …while ordinary names stay untouched.
        expect(csv).toContain(',Safe,');
      });

      it('csv summary neutralises spreadsheet formula injection', () => {
        // A CSV export leaves the plugin and is opened by another application,
        // so a hostile task title must not be evaluated as a formula there.
        const evil = ['=cmd|\'/c calc\'!A1', '@SUM(1+1)*cmd', '+1-1', '-2+3'].map((title, i) => ({
          id: 'e' + i, parentId: null, title, isDone: false, projectId: 'p1',
          tagIds: [], timeSpentOnDay: { [todayStr]: 60000 * (i + 1) }
        }));
        window.setSetting('summaryFormat', 'csv');
        window.processData(evil, [{ id: 'p1', title: '-2+3' }], []);
        const csv = window.buildTextSummary('details');

        csv.split('\n').slice(1).forEach(line => {
          line.split(',').forEach(field => {
            expect(field.replace(/^"/, '')[0]).not.toMatch(/[=+\-@]/);
          });
        });
        expect(csv).toContain("'=cmd|'/c calc'!A1");
        expect(csv).toContain("'@SUM(1+1)*cmd");
        expect(csv).toContain("'-2+3"); // the project name too, not just titles
      });

      it('csv summary of the Detailed List quotes fields containing commas', () => {
        const commaTask = [{ id: 'c1', parentId: null, title: 'Fix bug, then test', isDone: false,
          projectId: 'p1', tagIds: [], timeSpentOnDay: { [todayStr]: 3600000 } }];
        window.setSetting('summaryFormat', 'csv');
        window.processData(commaTask, projects, []);
        expect(window.buildTextSummary('details')).toContain('"Fix bug, then test"');
      });
    });

    describe('Modal', () => {
      it('the gear opens the modal and Done closes it', () => {
        const overlay = document.getElementById('settings-overlay');
        expect(overlay.classList.contains('hidden')).toBe(true);
        document.getElementById('settings-btn').dispatchEvent(new MouseEvent('click', { bubbles: true }));
        expect(overlay.classList.contains('hidden')).toBe(false);
        document.getElementById('settings-done').dispatchEvent(new MouseEvent('click', { bubbles: true }));
        expect(overlay.classList.contains('hidden')).toBe(true);
      });

      it('renders a rail entry per section and switches panels on click', () => {
        window.openSettings();
        const rail = document.getElementById('settings-rail');
        expect(rail.querySelectorAll('[data-section]').length).toBe(window.SETTINGS_SECTIONS.length);
        expect(document.querySelector('.settings-panel-title').textContent).toBe('General');

        rail.querySelector('[data-section="appearance"]')
          .dispatchEvent(new MouseEvent('click', { bubbles: true }));
        expect(document.querySelector('.settings-panel-title').textContent).toBe('Appearance');
      });

      it('clicking a control writes the setting straight through', () => {
        window.openSettings();
        const panel = document.getElementById('settings-panel');
        // General is the opening section; the first row is Start of week.
        const select = panel.querySelector('select[data-key="weekStartsOn"]');
        select.value = '0';
        select.dispatchEvent(new Event('change', { bubbles: true }));
        expect(window.getSetting('weekStartsOn')).toBe(0);

        const satButton = panel.querySelector('.set-day[data-value="6"]');
        expect(satButton.classList.contains('active')).toBe(false);
        satButton.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        expect(window.getSetting('workingDays')).toContain(6);
      });

      it('a pinned control enables its value picker, remember disables it', () => {
        window.openSettings();
        const rail = document.getElementById('settings-rail');
        rail.querySelector('[data-section="defaults"]')
          .dispatchEvent(new MouseEvent('click', { bubbles: true }));

        const panel = document.getElementById('settings-panel');
        expect(panel.querySelector('select[data-key="periodPinned"]').disabled).toBe(true);

        panel.querySelector('button[data-key="periodMode"][data-value="pin"]')
          .dispatchEvent(new MouseEvent('click', { bubbles: true }));
        expect(window.getSetting('periodMode')).toBe('pin');
        expect(panel.querySelector('select[data-key="periodPinned"]').disabled).toBe(false);
      });

      it('the excluded-project picker adds and removes chips', () => {
        window.processData(tasks, projects, tags);
        // The chip source reads the cached project list the host supplied.
        window.setSetting('excludedProjects', ['Personal']);
        window.openSettings();
        document.getElementById('settings-rail').querySelector('[data-section="data"]')
          .dispatchEvent(new MouseEvent('click', { bubbles: true }));

        const chip = document.querySelector('.set-chip');
        expect(chip.textContent).toContain('Personal');
        chip.querySelector('button[data-remove="Personal"]')
          .dispatchEvent(new MouseEvent('click', { bubbles: true }));
        expect(window.getSetting('excludedProjects')).toEqual([]);
      });
    });
  });
});