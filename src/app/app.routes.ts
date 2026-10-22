import {Routes} from '@angular/router';
import {Channels} from './pages/channels/channels';
import {Feed} from './pages/feed/feed';
import {Settings} from './pages/settings/settings';

export const routes: Routes = [
  {path: '', component: Feed, title: 'Akış · Özetçi'},
  {path: 'kanallar', component: Channels, title: 'Kanallar · Özetçi'},
  {path: 'ayarlar', component: Settings, title: 'Ayarlar · Özetçi'},
  {path: '**', redirectTo: ''},
];
