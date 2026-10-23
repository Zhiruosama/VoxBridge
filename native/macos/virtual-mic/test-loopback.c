#include "Loopback.h"
#include <assert.h>
#include <stdio.h>
int main(void) {
    vox_reset();float source[]={.25f,-.25f,.5f,-.5f},output[4];
    vox_read(1000+VOX_DELAY,2,output,1);assert(output[0]==0);
    vox_write(1000,2,source,1);vox_read(1000+VOX_DELAY,2,output,1);
    assert(output[0]==.25f&&output[3]==-.5f);
    // Independent readers, wrap-around, stale data and restarts must never replay old speech.
    vox_read(1000+VOX_DELAY,2,output,1);assert(output[0]==.25f);
    vox_read(1000+VOX_DELAY+VOX_CAPACITY,2,output,1);assert(output[0]==0);
    vox_write(1000+VOX_CAPACITY,2,source,1);vox_read(1000+VOX_DELAY,2,output,1);assert(output[0]==0);
    vox_read(1000+VOX_CAPACITY+VOX_DELAY,2,output,.5f);assert(output[0]==.125f);
    vox_read(1000+VOX_CAPACITY+VOX_DELAY,2,output,0);assert(output[0]==0);
    vox_reset();vox_read(1000+VOX_CAPACITY+VOX_DELAY,2,output,1);assert(output[0]==0);
    float invalid[]={NAN,INFINITY,3,-3};vox_write(0,2,invalid,1);vox_read(VOX_DELAY,2,output,1);
    assert(output[0]==0&&output[1]==0&&output[2]==1&&output[3]==-1);
    puts("VoxBridge loopback: pass");return 0;
}
