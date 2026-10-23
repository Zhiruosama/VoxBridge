// VoxBridge timestamped stereo PCM loopback. No microphone capture, persistence or network.
#ifndef VOX_LOOPBACK_H
#define VOX_LOOPBACK_H
#include <stdatomic.h>
#include <stdint.h>
#include <string.h>
#include <math.h>
#define VOX_CAPACITY 32768u
#define VOX_DELAY 512u
_Static_assert(ATOMIC_LLONG_LOCK_FREE == 2 && ATOMIC_INT_LOCK_FREE == 2, "lock-free atomics required");
typedef struct { _Atomic uint64_t frame; _Atomic uint32_t left; _Atomic uint32_t right; } VoxFrame;
static VoxFrame vox_frames[VOX_CAPACITY];
static void vox_reset(void) {
    for (unsigned i=0;i<VOX_CAPACITY;i++) atomic_store_explicit(&vox_frames[i].frame,UINT64_MAX,memory_order_seq_cst);
}
static float vox_sample(float value,float gain) {
    return isfinite(value) ? fmaxf(-1,fminf(1,value * gain)) : 0;
}
static void vox_write(uint64_t start,unsigned count,const float *input,float gain) {
    for(unsigned i=0;i<count;i++) {
        VoxFrame *slot=&vox_frames[(start+i)%VOX_CAPACITY];
        atomic_store_explicit(&slot->frame,UINT64_MAX,memory_order_seq_cst);
        float l=vox_sample(input[2*i],gain),r=vox_sample(input[2*i+1],gain);uint32_t lb,rb;
        memcpy(&lb,&l,4);memcpy(&rb,&r,4);
        atomic_store_explicit(&slot->left,lb,memory_order_seq_cst);
        atomic_store_explicit(&slot->right,rb,memory_order_seq_cst);
        atomic_store_explicit(&slot->frame,start+i,memory_order_seq_cst);
    }
}
static void vox_read(uint64_t start,unsigned count,float *output,float gain) {
    for(unsigned i=0;i<count;i++) {
        output[2*i]=output[2*i+1]=0;
        if(start+i<VOX_DELAY)continue;
        uint64_t frame=start+i-VOX_DELAY;VoxFrame *slot=&vox_frames[frame%VOX_CAPACITY];
        if(atomic_load_explicit(&slot->frame,memory_order_seq_cst)!=frame)continue;
        uint32_t lb=atomic_load_explicit(&slot->left,memory_order_seq_cst),rb=atomic_load_explicit(&slot->right,memory_order_seq_cst);
        if(atomic_load_explicit(&slot->frame,memory_order_seq_cst)!=frame)continue;
        float l,r;memcpy(&l,&lb,4);memcpy(&r,&rb,4);
        output[2*i]=vox_sample(l,gain);output[2*i+1]=vox_sample(r,gain);
    }
}
#endif
