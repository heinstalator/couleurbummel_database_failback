import React from 'react';

import {SettingsScreen} from '../../src/components/Settings';
import {render, screen} from '../__helpers__/test-utils';

describe('Settings', () => {
  it('renders language and theme without the database section when the online database is not in use', async () => {
    render(<SettingsScreen {...({} as any)} />);

    expect(await screen.findByTestId('Screen:Settings')).toBeTruthy();
    expect(screen.queryByTestId('Settings:Database')).toBeNull();
  });
});
