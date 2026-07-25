const test = require('node:test');
const assert = require('node:assert/strict');

test('collapsedDueSections can track collapsed section state', () => {
  const collapsedSections = new Set();

  // Initially no sections are collapsed
  assert.equal(collapsedSections.has('Overdue'), false);
  assert.equal(collapsedSections.has('Today'), false);

  // Add a section to collapsed
  collapsedSections.add('Overdue');
  assert.equal(collapsedSections.has('Overdue'), true);
  assert.equal(collapsedSections.has('Today'), false);

  // Add another section
  collapsedSections.add('Today');
  assert.equal(collapsedSections.has('Overdue'), true);
  assert.equal(collapsedSections.has('Today'), true);

  // Remove a section from collapsed
  collapsedSections.delete('Overdue');
  assert.equal(collapsedSections.has('Overdue'), false);
  assert.equal(collapsedSections.has('Today'), true);
});

test('toggleDueSection behavior (simulated)', () => {
  const collapsedSections = new Set();

  // Simulate toggle function behavior
  const toggleSection = (title) => {
    if (!collapsedSections.has(title)) {
      collapsedSections.add(title);
    } else {
      collapsedSections.delete(title);
    }
  };

  // First toggle: should collapse (not in set, add it)
  toggleSection('Overdue');
  assert.equal(collapsedSections.has('Overdue'), true);

  // Second toggle: should expand (in set, remove it)
  toggleSection('Overdue');
  assert.equal(collapsedSections.has('Overdue'), false);

  // Third toggle: should collapse again
  toggleSection('Overdue');
  assert.equal(collapsedSections.has('Overdue'), true);

  // Multiple sections can be collapsed independently
  toggleSection('Today');
  assert.equal(collapsedSections.has('Overdue'), true);
  assert.equal(collapsedSections.has('Today'), true);

  toggleSection('Overdue');
  assert.equal(collapsedSections.has('Overdue'), false);
  assert.equal(collapsedSections.has('Today'), true);
});

test('collapsedDueSections can be serialized to/from array for storage', () => {
  // Simulating persistence: Set -> Array -> Set
  const originalSet = new Set(['Overdue', 'This Week']);
  
  // Convert to array for storage
  const stored = Array.from(originalSet);
  assert(Array.isArray(stored), 'converted to array');
  assert.equal(stored.length, 2);
  assert(stored.includes('Overdue'));
  assert(stored.includes('This Week'));
  
  // Load from storage back to Set
  const restored = new Set(stored);
  assert.equal(restored.has('Overdue'), true);
  assert.equal(restored.has('This Week'), true);
  assert.equal(restored.size, 2);
  
  // Verify behavior after restoration
  restored.delete('Overdue');
  assert.equal(restored.has('Overdue'), false);
  assert.equal(restored.has('This Week'), true);
});
