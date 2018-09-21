var mWidth = 0;
var mHeight = 0;
//
var descArray = [];
var numOfDescPerFace = 5;
var similarityThreshold = 0.45;
var recognizedName = "?";
var uniquePersonCnt;
var recogInitialized = false;
var galleryFileName = "test_recognition.txt";
//
var ENVIRONMENT_IS_WORKER = typeof importScripts === 'function';
if (ENVIRONMENT_IS_WORKER)
{
	var locationObj = self.location;
}

self.onmessage = function (msg) {
	switch (msg.data.aTopic) {
		case 'resolution':
			mWidth = msg.data.mWidth;
			mHeight = msg.data.mHeight;
			break;
		case 'sendFrame':
			imageData = new Uint8ClampedArray(msg.data.imageData);
			if (recogInitialized)
			{
				m_faceData.parseJson(msg.data.inFaceData);
			}
			galleryFrozen = msg.data.statusFrozen;
			trackRecognition();
			break;
		case 'trackStatus':
			for(var i=0; i<descArray.length;i++)
			{
				descArray[i].delete();
			}
			descArray = [];
			self.postMessage({aTopic:'recognition reset'});
			break;
		case 'loadGallery':
			loadGallery();
			break;
		case 'saveGallery':
			saveGallery();
			break;
		case 'clearGallery':
			uniquePersonCnt = 0;
			clearGallery();
			resetInitialization();
			break;
		case 'changeName':
			changeName(msg.data.changedNames);
			break;
		default:
			throw 'no aTopic on incoming message to Worker';
	}
}

importScripts('../../lib/visageSDK.js');

var Module = VisageModule({onRuntimeInitialized: onModuleInitialized});

importScripts('../../lib/visageRecognitionData.js');

function callbackDownload()
{
}

function onModuleInitialized()
{
	ppixels = Module._malloc(mWidth*mHeight*4);
	pixels = new Uint8Array(Module.HEAPU8.buffer, ppixels, mWidth*mHeight*4);
	
	alert = function(msg) 
	{ 
		console.log(msg); 
	}
	
	//set up tracker and licensing, valid license needs to be provided
	Module.initializeLicenseManager("471-308-776-250-553-231-598-221-624-198-522.vlc");
	m_Recog = new Module.VisageFaceRecognition();
	m_faceData = new Module.FaceData();
	recogInitialized = true;
	uniquePersonCnt = 0;
	self.postMessage({aTopic:'initialization done'});
}

/**
* Changes names of the face descriptors in the VisageFaceRecognition gallery.
* <br/><br/>
* @param {dictionary} changedNames - dictionary with old names as keys and new names as values.
* Searches through all the descriptors in the VisageFaceRecognition gallery and changes names according to input dictionary.
*/
function changeName(changedNames)
{
	for(var i = 0; i < m_Recog.getDescriptorCount(); ++i)
	{
		var currentName = m_Recog.getDescriptorName(i);
		if (!(currentName in changedNames))
		{
			continue;
		}
		else
		{
			m_Recog.replaceDescriptorName(changedNames[currentName], i)
		}
	}
	
	self.postMessage({aTopic: 'name changed'});		
}


/**
* Loads VisageFaceRecognition gallery from IndexedDB.
* <br/><br/>
* Loads the gallery to be displayed in the samples GUI gallery.
*/
function loadGallery()
{
	if (recogInitialized)
	{	
		m_Recog.loadGallery(galleryFileName, function(name, status)
		{   
			var	names = [];
			
			//If gallery is empty sends an empty array, otherwise adds the name from gallery in the array. 
			//If there is more then one descriptor per name the name is added only once. 
			if(status)
			{	
				if (m_Recog.getDescriptorCount() === 0)
				{
					names = [];
				}
				else
				{
					for (var i = 0; i < m_Recog.getDescriptorCount(); ++i)
					{
						names.indexOf(m_Recog.getDescriptorName(i)) === -1 ? names.push(m_Recog.getDescriptorName(i)) : console.log("This item already exists");
					}
					//Find last number in the name assigned to person
					for(var i = 0; i < names.length; ++i)
					{
						var num = names[i].charAt(names[i].length-1);
						var personIndex = parseInt(num);
						if(!isNaN(personIndex))
							uniquePersonCnt = personIndex;
					}
				}
			}
			self.postMessage({aTopic: 'gallery loaded', nameArray: names});	
			for(var i = 0; i < names.length; i++)
			{
				delete names[i];
			}
		});
	}
}

/**
* Saves VisageFaceRecognition gallery to IndexedDB.
* <br/><br/>
* 
*/
function saveGallery()
{
	if (recogInitialized)
	{
		m_Recog.saveGallery(galleryFileName, function(name, status)
		{   
		   if(status)
		   {	
				self.postMessage({aTopic: 'gallery saved'});	
		   }
		});
	}
}

/**
* Clears all face descriptors from the VisageFaceRecognition gallery. 
* <br/><br/>
* Deletes all descriptors from the gallery.
*/
function clearGallery()
{
	if (recogInitialized)
	{
		m_Recog.resetGallery();
		
	}
	self.postMessage({aTopic:'gallery cleared'});
}

function resetInitialization()
{
	if(descArray.length > 0)
	{
		for(var i=0; i<descArray.length;i++)
		{
			descArray[i].delete();
		}
		descArray = [];
	}
}



/**
* Extracts the face descriptor for face recognition from an image and compares it with all descriptors in the current VisageFaceRecognition gallery.
* <br/><br/>
* Tries to recognize face based on descriptors' similarity. If the similarity is below similarityThreshold(0.45) threshold through numOfDescPerFace(5) iterations, the face is added to the gallery. 
* If freeze gallery option is checked new face descritpors will not be added to the gallery.
*/
function trackRecognition()
{
	if (recogInitialized && !galleryFrozen)
	{
		for(i=0; i<imageData.length; i+=1)
		{
			pixels[i] = imageData[i];
		}
		
		var descriptor = new Module.VectorShort();
		var similarityArray = new Module.VectorFloat();
		var nameArray = new Module.VectorString();
		var numRecFaces = 1;
		
		//Extract the face descriptor from an image to the descriptor variable
		var success = m_Recog.extractDescriptor(
			m_faceData,
			mWidth,
			mHeight,
			ppixels,
			descriptor);

		//Compare descriptor to all descriptors in the current gallery and find the most similar identity
		//nameArray and similarityArray are populated with numRecFaces(1) names and similarity indices
		var numOfSim = 0;
		var count = m_Recog.getDescriptorCount();
		if(count > 0)
		{
			numOfSim = m_Recog.recognize(descriptor, numRecFaces, nameArray, similarityArray);
		}
		//Identity is recognized successfully (similarity index is over the threshold)
		//Return the name of the identity
		if(numOfSim > 0 && similarityArray.get(0) > similarityThreshold)
		{	
			resetInitialization();
			recognizedName = nameArray.get(0);
			descriptor.delete();	
		}
		//There are no similar faces found in the gallery, go into initialization phase 
		//collect numOfDescPerFace(5) descriptors for the new identity and then add it to the gallery
		else
		{
			//There are already some descriptors for the new identity
			if(descArray.length > 0)
			{
				//Check the similarity with already collected descriptors
				//Determine if new identity appears during the initialization phase
				var maxSim = 0;
				for(var i = 0; i < descArray.length; i++)
				{
					var sim = m_Recog.descriptorsSimilarity(descArray[i],descriptor);
					if(sim > maxSim)
					{
						maxSim = sim;
					}
				}
				//Descriptor is similar to the already collected descriptors, add
				if(maxSim > similarityThreshold)
				{
					descArray.push(descriptor);
				}
				//New identity appeared during the unfinished initialization, reset initialization
				else
				{
					descArray = [];
					descArray.push(descriptor);
				}
			}
			//There are no descriptors for the new identity, add the first one
			else
			{	
				descArray.push(descriptor);
			}
			
			//If numOfDescPerFace(5) descriptors are collected assign an unique name and add them to the gallery,
			//else assign "?" 
			if(descArray.length >= numOfDescPerFace)
			{
				recognizedName = "Person"+(uniquePersonCnt+1).toString();
				uniquePersonCnt ++;
				for(var i = 0; i < descArray.length; i++)
				{
					m_Recog.addDescriptor(descArray[i],recognizedName);
					descArray[i].delete();
				}
				descArray = [];
			}
			else
			{
				recognizedName = "?";
			}
		
		}		
		similarityArray.delete();
		nameArray.delete();
	}
	//If freeze gallery option is checked (forbid adding new identities to the gallery)
	else if(recogInitialized && galleryFrozen)
	{
		for(i=0; i<imageData.length; i+=1)
		{
			pixels[i] = imageData[i];
		}
		
		if(descArray.length > 0)
		{
			resetInitialization();
		}
		
		//Get the number of descriptors from the gallery
		var count = m_Recog.getDescriptorCount();
		
		if (count > 0)
		{
			var descriptor = new Module.VectorShort();
			var similarityArray = new Module.VectorFloat();
			var nameArray = new Module.VectorString();
			
			//Extract the face descriptor for face recognition from an image
			m_Recog.extractDescriptor(m_faceData, mWidth, mHeight, ppixels, descriptor);
			
			//Check similarity
			var numOfSim = m_Recog.recognize(descriptor, 1, nameArray, similarityArray);
			
			//Face is recognized, send its name
			if(numOfSim>0 && similarityArray.get(0)>0.45)
			{
				recognizedName = nameArray.get(0);
			}
			//otherwise send "?"
			else
			{
				recognizedName = "?";
			}
			
			descriptor.delete();
			similarityArray.delete();
			nameArray.delete();	
		}
		else
		{
			recognizedName = "?";
		}
	}
	self.postMessage({aTopic:'results recieved', recognizedName : recognizedName});
}