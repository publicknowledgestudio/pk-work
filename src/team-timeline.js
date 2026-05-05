import { updateTask } from './db.js'
import { openModal } from './modal.js'
import { toLocalISODate } from './utils/dates.js'
import {
  generateColumns,
  assignTaskToColumn,
  taskCard,
  addDays,
  getMondayOfWeek,
  formatWeekRange,
} from './client-timeline.js'

export function renderTeamTimeline(container, tasks, ctx) {
  let weekStart = getMondayOfWeek(new Date())

  function render() {
    const columns = generateColumns(weekStart)
    const weekEnd = addDays(weekStart, 6)

    const buckets = { unscheduled: [] }
    for (const col of columns) buckets[col.id] = []

    for (const task of tasks) {
      const colId = assignTaskToColumn(task, columns)
      if (colId === null) continue
      if (!buckets[colId]) buckets[colId] = []
      buckets[colId].push(task)
    }

    container.innerHTML = `
      <div class="timeline-view">
        <div class="timeline-header">
          <div class="week-picker">
            <button class="week-picker-btn week-prev" title="Previous week"><i class="ph ph-caret-left"></i></button>
            <button class="week-picker-label week-label">${formatWeekRange(weekStart, weekEnd)}</button>
            <button class="week-picker-btn week-next" title="Next week"><i class="ph ph-caret-right"></i></button>
          </div>
        </div>
        <div class="timeline-board">
          <div class="timeline-col timeline-col-unscheduled">
            <div class="column-header">
              <span class="column-dot" style="background:var(--text-tertiary)"></span>
              <span class="column-label">Unscheduled</span>
              <span class="column-count">${buckets.unscheduled.length}</span>
            </div>
            <div class="column-tasks" data-col="unscheduled">
              ${buckets.unscheduled.map((t) => taskCard(t, ctx)).join('')}
            </div>
          </div>
          ${columns.map((col) => `
            <div class="timeline-col${col.isToday ? ' timeline-col-today' : ''}">
              <div class="column-header">
                <span class="column-label">${col.label}</span>
                <span class="column-count">${(buckets[col.id] || []).length}</span>
              </div>
              <div class="column-tasks" data-col="${col.id}" data-date="${toLocalISODate(col.date)}">
                ${(buckets[col.id] || []).map((t) => taskCard(t, ctx)).join('')}
              </div>
            </div>
          `).join('')}
        </div>
      </div>
    `

    container.querySelector('.week-prev')?.addEventListener('click', () => {
      weekStart = addDays(weekStart, -7)
      render()
    })
    container.querySelector('.week-next')?.addEventListener('click', () => {
      weekStart = addDays(weekStart, 7)
      render()
    })
    container.querySelector('.week-label')?.addEventListener('click', () => {
      weekStart = getMondayOfWeek(new Date())
      render()
    })

    container.querySelectorAll('.task-card').forEach((card) => {
      card.addEventListener('click', (e) => {
        if (e.target.closest('.status-btn')) return
        const task = tasks.find((t) => t.id === card.dataset.id)
        if (task) openModal(task, ctx)
      })
    })

    container.querySelectorAll('.task-card').forEach((card) => {
      card.addEventListener('dragstart', (e) => {
        e.dataTransfer.setData('text/plain', card.dataset.id)
        e.dataTransfer.effectAllowed = 'move'
        card.classList.add('dragging')
      })
      card.addEventListener('dragend', () => {
        card.classList.remove('dragging')
        container.querySelectorAll('.column-tasks').forEach((col) => col.classList.remove('drag-over'))
      })
    })

    container.querySelectorAll('.column-tasks').forEach((col) => {
      col.addEventListener('dragover', (e) => {
        e.preventDefault()
        e.dataTransfer.dropEffect = 'move'
        col.classList.add('drag-over')
      })
      col.addEventListener('dragleave', () => col.classList.remove('drag-over'))
      col.addEventListener('drop', async (e) => {
        e.preventDefault()
        col.classList.remove('drag-over')
        const taskId = e.dataTransfer.getData('text/plain')
        if (!taskId) return

        const colId = col.dataset.col
        if (colId === 'unscheduled') {
          await updateTask(ctx.db, taskId, { deadline: null })
        } else {
          const dateStr = col.dataset.date
          if (dateStr) {
            await updateTask(ctx.db, taskId, { deadline: dateStr })
          }
        }
      })
    })
  }

  render()
}
