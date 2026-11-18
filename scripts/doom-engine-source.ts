// GPL-2.0-or-later, like the pinned doomgeneric source this adapter links with.
// Kept as build input so the downloaded upstream checkout remains untouched.
export const arcadeBridge = `
#include <string.h>
#include "doomstat.h"
#include "g_game.h"
#include "d_ticcmd.h"
#include "doomgeneric.h"
#include "i_video.h"
#include "r_main.h"
#include "v_video.h"
#include "s_sound.h"
#include "m_random.h"
extern int gametic;
extern void D_Display(void);
extern void R_ExecuteSetViewSize(void);
static ticcmd_t arcade_commands[MAXPLAYERS];
static int ticks, active_ticks, map_ticks, last_map = 1, finished;
static int split_count;
// map, duration, cumulative duration, command cursor, kills, total kills, secrets, total secrets
static int splits[16][8];
void Arcade_Complete(void) {
  if (split_count >= 16 || finished) return;
  int *s = splits[split_count++];
  s[0]=gamemap; s[1]=map_ticks; s[2]=active_ticks; s[3]=ticks+1;
  s[4]=players[0].killcount; s[5]=totalkills;
  s[6]=players[0].secretcount; s[7]=totalsecret;
  if (gamemap == 8) finished=1;
}
void arcade_step(int mask) {
  if (finished) return;
  ticcmd_t *c=&arcade_commands[0];
  memset(c,0,sizeof(*c));
  int speed=(mask & 64) ? 50 : 25;
  c->forwardmove=((mask&1)!=0)*speed-((mask&2)!=0)*speed;
  c->sidemove=((mask&32)!=0)*(speed*4/5)-((mask&16)!=0)*(speed*4/5);
  c->angleturn=((mask&4)!=0)*640-((mask&8)!=0)*640;
  c->buttons=((mask&128)?BT_ATTACK:0)|((mask&256)?BT_USE:0);
  int weapon=(mask>>9)&7;
  if (weapon) c->buttons |= BT_CHANGE|((weapon-1)<<BT_WEAPONSHIFT);
  netcmds=arcade_commands;
  G_Ticker();
  if (gamemap != last_map) { map_ticks=0; last_map=gamemap; }
  if (!finished && gamestate == GS_LEVEL) { active_ticks++; map_ticks++; }
  ticks++; gametic++;
}
int arcade_get(int field) {
  switch(field) {
    case 0:return ticks; case 1:return active_ticks; case 2:return gamemap;
    case 3:return map_ticks; case 4:return finished; case 5:return split_count;
    case 6:return players[0].health; case 7:return players[0].mo ? players[0].mo->x : 0;
    case 8:return players[0].mo ? players[0].mo->y : 0;
    case 9:return rndindex; case 10:return gamestate;
    default:return 0;
  }
}
int arcade_split(int index,int field) {
  if(index<0 || index>=split_count || field<0 || field>=8) return -1;
  return splits[index][field];
}
void arcade_draw(void) {
  S_UpdateSounds(players[0].mo);
  D_Display();
}
void Arcade_LoopInit(void) {
  I_InitGraphics(); V_RestoreBuffer(); R_ExecuteSetViewSize();
}
`;

export const headlessPort = `
#include "doomgeneric.h"
void DG_Init(void) {}
void DG_DrawFrame(void) {}
void DG_SleepMs(uint32_t ms) {}
uint32_t DG_GetTicksMs(void) { static uint32_t t; return ++t; }
int DG_GetKey(int *pressed, unsigned char *key) { return 0; }
void DG_SetWindowTitle(const char *title) {}
int main(int argc,char **argv) { doomgeneric_Create(argc,argv); return 0; }
`;
