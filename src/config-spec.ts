import { defineConfigSpec, integerIn, matching, required } from 'busybar-kit/config-spec';
import { HARD_MAX_TILES } from './view/frame.js';

export default defineConfigSpec({
  name: 'discord',
  summary: 'Who is in your voice channel, and who is talking',
  sections: [
    {
      kind: 'env',
      file: '.env',
      title: 'Discord',
      reloads: 'restart',
      fields: [
        {
          key: 'DISCORD_CLIENT_ID',
          label: 'Application ID',
          type: 'text',
          required: true,
          placeholder: '1234567890123456789',
          hint: 'From discord.com/developers/applications — the OAuth2 page of an app you own',
          rules: [
            required('An application ID'),
            matching('^[0-9]{15,25}$', 'Discord ids are 17 to 20 digits, nothing else'),
          ],
        },
        {
          key: 'DISCORD_CLIENT_SECRET',
          label: 'Client secret',
          type: 'secret',
          required: true,
          hint: 'Beside the id on the same page. Kept here, never sent anywhere but Discord',
          rules: [required('A client secret')],
        },
        {
          key: 'DISCORD_REDIRECT_URI',
          label: 'Redirect',
          type: 'text',
          fallback: 'http://localhost',
          hint: 'Must be one of the redirects registered on that OAuth2 page',
        },
        {
          key: 'DISCORD_SCOPES',
          label: 'Permissions to ask for',
          type: 'text',
          fallback: 'rpc,rpc.voice.read,rpc.voice.write',
          hint: 'Drop rpc.voice.write to give up the mute button and ask for less',
        },
      ],
    },
    {
      kind: 'env',
      file: '.env',
      title: 'The row of faces',
      reloads: 'restart',
      fields: [
        {
          key: 'MAX_AVATARS',
          label: 'How many at once',
          type: 'number',
          fallback: '5',
          hint: `Up to ${HARD_MAX_TILES}. Anyone past this is counted at the end of the strip`,
          rules: [integerIn(1, HARD_MAX_TILES)],
        },
        {
          key: 'HIDE_BOTS',
          label: 'Leave bots out',
          type: 'boolean',
          fallback: '1',
          hint: 'A music bot is in the channel but not in the conversation',
        },
        {
          key: 'AVATAR_GAIN',
          label: 'Avatar brightness',
          type: 'text',
          fallback: '1.15',
          hint: 'Photographs are dark at twelve pixels. 1 leaves them as they came',
          rules: [
            matching('^[0-9]+(\\.[0-9]+)?$', 'a number between 0.5 and 2, such as 1.15'),
          ],
        },
      ],
    },
    {
      kind: 'env',
      file: '.env',
      title: 'Buttons',
      reloads: 'restart',
      fields: [
        {
          key: 'MUTE_BUTTON',
          label: 'Mute the microphone with',
          type: 'select',
          fallback: 'start',
          options: [
            {
              value: 'start',
              label: 'START',
              hint: 'busybar-wm leaves this one alone — but busybar-nowplaying uses it too',
            },
            { value: 'ok', label: 'OK', hint: 'busybar-wm cycles apps with this' },
            { value: 'back', label: 'BACK', hint: 'busybar-wm unpins with this' },
            {
              value: 'none',
              label: 'off',
              hint: 'the Bar does not touch your microphone',
            },
          ],
        },
        {
          key: 'BAR_INPUT',
          label: "Listen to the Bar's controls",
          type: 'boolean',
          fallback: '1',
        },
      ],
    },
  ],
});
