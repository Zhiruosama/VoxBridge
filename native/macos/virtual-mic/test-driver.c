// Exercise the production HAL ABI without loading anything into coreaudiod.
#include "VoxBridgeAudio.c"
#include <assert.h>
int main(void) {
    AudioObjectPropertyAddress address={kAudioObjectPropertyName,kAudioObjectPropertyScopeGlobal,kAudioObjectPropertyElementMain};
    CFStringRef name=NULL;UInt32 size=0;
    assert(VoxBridgeAudio_GetDevicePropertyData(gAudioServerPlugInDriverRef,kObjectID_Device,0,&address,0,NULL,sizeof(name),&size,&name)==0);
    assert(CFEqual(name,CFSTR("VoxBridge")));CFRelease(name);
    address.mSelector=kAudioDevicePropertyDeviceUID;
    assert(VoxBridgeAudio_GetDevicePropertyData(gAudioServerPlugInDriverRef,kObjectID_Device,0,&address,0,NULL,sizeof(name),&size,&name)==0);
    assert(CFEqual(name,CFSTR("com.voxbridge.audio.device")));CFRelease(name);
    // A visible, alive device that can be the default input, with a microphone terminal.
    UInt32 value=99;
    address.mSelector=kAudioDevicePropertyIsHidden;
    assert(VoxBridgeAudio_GetDevicePropertyData(gAudioServerPlugInDriverRef,kObjectID_Device,0,&address,0,NULL,sizeof(value),&size,&value)==0&&value==0);
    address.mSelector=kAudioDevicePropertyDeviceIsAlive;
    assert(VoxBridgeAudio_GetDevicePropertyData(gAudioServerPlugInDriverRef,kObjectID_Device,0,&address,0,NULL,sizeof(value),&size,&value)==0&&value==1);
    address.mSelector=kAudioDevicePropertyDeviceCanBeDefaultDevice;address.mScope=kAudioObjectPropertyScopeInput;
    assert(VoxBridgeAudio_GetDevicePropertyData(gAudioServerPlugInDriverRef,kObjectID_Device,0,&address,0,NULL,sizeof(value),&size,&value)==0&&value==1);
    address.mSelector=kAudioStreamPropertyTerminalType;address.mScope=kAudioObjectPropertyScopeGlobal;
    assert(VoxBridgeAudio_GetStreamPropertyData(gAudioServerPlugInDriverRef,kObjectID_Stream_Input,0,&address,0,NULL,sizeof(value),&size,&value)==0&&value==kAudioStreamTerminalTypeMicrophone);
    // Chromium uses the selected data-source label rather than the device name.
    address.mSelector=kAudioObjectPropertyName;
    AudioObjectID streams[]={kObjectID_Stream_Input,kObjectID_Stream_Output};
    for(unsigned i=0;i<2;i++) {
        AudioObjectID stream=streams[i];
        assert(VoxBridgeAudio_GetStreamPropertyData(gAudioServerPlugInDriverRef,stream,0,&address,0,NULL,sizeof(name),&size,&name)==0);
        assert(CFEqual(name,CFSTR("VoxBridge")));CFRelease(name);
    }
    address.mSelector=kAudioSelectorControlPropertyItemName;UInt32 item=0;
    AudioObjectID sources[]={kObjectID_DataSource_Input_Master,kObjectID_DataSource_Output_Master};
    for(unsigned i=0;i<2;i++) {
        assert(VoxBridgeAudio_GetControlPropertyData(gAudioServerPlugInDriverRef,sources[i],0,&address,sizeof(item),&item,sizeof(name),&size,&name)==0);
        assert(CFEqual(name,CFSTR("VoxBridge")));CFRelease(name);
    }
    assert(VoxBridgeAudio_StartIO(gAudioServerPlugInDriverRef,kObjectID_Device,1)==0);
    AudioServerPlugInIOCycleInfo cycle={0};cycle.mOutputTime.mSampleTime=1000;cycle.mInputTime.mSampleTime=1000+VOX_DELAY;
    float source[]={.25,-.5,.75,-1},output[4]={0};
    assert(VoxBridgeAudio_DoIOOperation(gAudioServerPlugInDriverRef,kObjectID_Device,kObjectID_Stream_Output,1,kAudioServerPlugInIOOperationWriteMix,2,&cycle,source,NULL)==0);
    assert(VoxBridgeAudio_DoIOOperation(gAudioServerPlugInDriverRef,kObjectID_Device,kObjectID_Stream_Input,2,kAudioServerPlugInIOOperationReadInput,2,&cycle,output,NULL)==0);
    assert(output[0]==.25&&output[3]==-1);
    gMute_Input_Master_Value=true;
    assert(VoxBridgeAudio_DoIOOperation(gAudioServerPlugInDriverRef,kObjectID_Device,kObjectID_Stream_Input,2,kAudioServerPlugInIOOperationReadInput,2,&cycle,output,NULL)==0);
    assert(output[0]==0);gMute_Input_Master_Value=false;
    assert(VoxBridgeAudio_DoIOOperation(gAudioServerPlugInDriverRef,kObjectID_Device,kObjectID_Stream_Input,2,kAudioServerPlugInIOOperationReadInput,VOX_CAPACITY+1,&cycle,output,NULL)!=0);
    assert(VoxBridgeAudio_StopIO(gAudioServerPlugInDriverRef,kObjectID_Device,1)==0);
    assert(VoxBridgeAudio_StartIO(gAudioServerPlugInDriverRef,kObjectID_Device,1)==0);
    assert(VoxBridgeAudio_DoIOOperation(gAudioServerPlugInDriverRef,kObjectID_Device,kObjectID_Stream_Input,2,kAudioServerPlugInIOOperationReadInput,2,&cycle,output,NULL)==0);
    assert(output[0]==0);
    puts("VoxBridge HAL contract: pass");return 0;
}
