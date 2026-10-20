// A team saved straight from a template still holds the template's placeholders: refuse it, with the reason.
import { expect, test } from 'claude-code/testing';
import { parseTeam } from '../hooks/team';
const team = (over) => JSON.stringify({
    name: 'Booking App Team',
    purpose: 'Build the booking app',
    lead: { title: 'Tech Lead', rules: [], skills: [] },
    roles: [{ id: 'dev', title: 'Developer', count: 1, mission: 'Build.', tasks: [], rules: [], skills: [] }],
    ...over,
});
test('a real name and purpose are accepted, angle brackets and all when they are not a placeholder', () => {
    expect(parseTeam(team({}))).toMatchObject({ name: 'Booking App Team' });
    expect(typeof parseTeam(team({ purpose: 'Keep a < b and c > d working' }))).toBe('object');
    expect(typeof parseTeam(team({ name: 'QA < Dev' }))).toBe('object'); // no closing bracket: not a placeholder
});
test('a name that still has a <...> placeholder is refused and says so', () => {
    for (const name of ['<team name>', 'Booking <name> Team', '<purpose: what the team does>', 'Team <x>']) {
        const result = parseTeam(team({ name }));
        expect(typeof result, name).toBe('string');
        expect(result, name).toMatch(/name/);
        expect(result, name).toMatch(/placeholder/);
    }
});
test('a purpose that is still the template placeholder is refused and says so', () => {
    const result = parseTeam(team({ purpose: "<purpose: one sentence on what this team builds or achieves, taken from the person's goal>" }));
    expect(typeof result).toBe('string');
    expect(result).toMatch(/purpose/);
    expect(result).toMatch(/placeholder/);
    expect(typeof parseTeam(team({ purpose: 'Our <purpose: wording> is fine?' }))).toBe('string'); // any <purpose: ...> is refused
});
test('a team saved straight from a template is refused until its purpose is filled in', () => {
    // the shape the templates have: a real name and the purpose placeholder, which the team skill replaces
    const shipped = JSON.parse(team({ name: 'Software Feature Team', purpose: '<purpose: one sentence on what this team builds>' }));
    expect(typeof parseTeam(JSON.stringify(shipped))).toBe('string');
    expect(typeof parseTeam(JSON.stringify({ ...shipped, purpose: 'Add search to the storefront' }))).toBe('object');
});
